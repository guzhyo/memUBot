import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'
import * as crypto from 'node:crypto'

import { isPathInside } from '../path-guards'
import { resolveBoundaryPath, resolveBoundaryPathSync } from '../boundary-path'
import { assertNoHardlinkedFinalPath, assertNoHardlinkedFinalPathSync } from '../hardlink-guards'
import { assertNoPathAliasEscape, assertNoPathAliasEscapeSync } from '../path-alias-guards'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpRoot: string
let sandbox: string
let outside: string

beforeEach(async () => {
  tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'pbg-test-'))
  sandbox = path.join(tmpRoot, 'sandbox')
  outside = path.join(tmpRoot, 'outside')
  await fsp.mkdir(sandbox, { recursive: true })
  await fsp.mkdir(outside, { recursive: true })
})

afterEach(async () => {
  await fsp.rm(tmpRoot, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// 1. Lexical path tests (isPathInside – no I/O)
// ---------------------------------------------------------------------------

describe('isPathInside (lexical)', () => {
  it('allows a child path', () => {
    expect(isPathInside('/root', '/root/child')).toBe(true)
  })

  it('allows root equal to target', () => {
    expect(isPathInside('/root', '/root')).toBe(true)
  })

  it('rejects ../ traversal', () => {
    expect(isPathInside('/root', '/root/../etc/passwd')).toBe(false)
  })

  it('rejects absolute path outside root', () => {
    expect(isPathInside('/root', '/other/file')).toBe(false)
  })

  it('allows deeply nested path', () => {
    expect(isPathInside('/a', '/a/b/c/d/e')).toBe(true)
  })

  it('rejects sibling directory', () => {
    expect(isPathInside('/a/b', '/a/c')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 2. Symlink tests (skip on Windows)
// ---------------------------------------------------------------------------

describe.skipIf(process.platform === 'win32')('symlink boundary checks', () => {
  it('allows symlink pointing inside the sandbox', async () => {
    const realDir = path.join(sandbox, 'realdir')
    await fsp.mkdir(realDir)
    await fsp.writeFile(path.join(realDir, 'file.txt'), 'ok')

    const linkPath = path.join(sandbox, 'link-to-realdir')
    await fsp.symlink(realDir, linkPath)

    const target = path.join(linkPath, 'file.txt')
    const result = await resolveBoundaryPath({
      absolutePath: target,
      rootPath: sandbox,
      intent: 'read',
      boundaryLabel: 'sandbox root',
    })

    expect(result.exists).toBe(true)
    expect(result.kind).toBe('file')
  })

  it('rejects symlink pointing outside the sandbox', async () => {
    const outsideFile = path.join(outside, 'secret.txt')
    await fsp.writeFile(outsideFile, 'secret')

    const linkPath = path.join(sandbox, 'escape-link')
    await fsp.symlink(outside, linkPath)

    const target = path.join(linkPath, 'secret.txt')
    await expect(
      resolveBoundaryPath({
        absolutePath: target,
        rootPath: sandbox,
        intent: 'read',
        boundaryLabel: 'sandbox root',
      })
    ).rejects.toThrow(/Symlink.*escapes sandbox root/)
  })

  it('rejects accessing non-existent file through escaping symlink', async () => {
    const linkPath = path.join(sandbox, 'escape-link')
    await fsp.symlink(outside, linkPath)

    const target = path.join(linkPath, 'does-not-exist.txt')
    await expect(
      resolveBoundaryPath({
        absolutePath: target,
        rootPath: sandbox,
        intent: 'read',
        boundaryLabel: 'sandbox root',
      })
    ).rejects.toThrow(/Symlink.*escapes sandbox root/)
  })

  it('allows final symlink for unlink when policy permits', async () => {
    const outsideFile = path.join(outside, 'target.txt')
    await fsp.writeFile(outsideFile, 'data')

    const linkPath = path.join(sandbox, 'external-link')
    await fsp.symlink(outsideFile, linkPath)

    const result = await resolveBoundaryPath({
      absolutePath: linkPath,
      rootPath: sandbox,
      intent: 'delete',
      boundaryLabel: 'sandbox root',
      policy: { allowFinalSymlinkForUnlink: true },
    })

    expect(result.kind).toBe('symlink')
    expect(result.exists).toBe(true)
  })

  it('allows root accessed via symlink alias when canonical is inside boundary', async () => {
    const realSandbox = path.join(tmpRoot, 'real-sandbox')
    await fsp.mkdir(realSandbox, { recursive: true })
    await fsp.writeFile(path.join(realSandbox, 'hello.txt'), 'hi')

    const aliasRoot = path.join(tmpRoot, 'alias-sandbox')
    await fsp.symlink(realSandbox, aliasRoot)

    const target = path.join(aliasRoot, 'hello.txt')
    const result = await resolveBoundaryPath({
      absolutePath: target,
      rootPath: aliasRoot,
      intent: 'read',
      boundaryLabel: 'workspace',
    })

    expect(result.exists).toBe(true)
    expect(result.kind).toBe('file')
  })

  it('sync version rejects escaping symlinks', () => {
    const outsideFile = path.join(outside, 'secret.txt')
    fs.writeFileSync(outsideFile, 'secret')

    const linkPath = path.join(sandbox, 'escape-link')
    fs.symlinkSync(outside, linkPath)

    const target = path.join(linkPath, 'secret.txt')
    expect(() =>
      resolveBoundaryPathSync({
        absolutePath: target,
        rootPath: sandbox,
        intent: 'read',
        boundaryLabel: 'sandbox root',
      })
    ).toThrow(/Symlink.*escapes sandbox root/)
  })

  describe('fuzz: 32 random paths with mixed symlinks', () => {
    it('correctly classifies random safe and unsafe symlinks', async () => {
      const safeDir = path.join(sandbox, 'safe-target')
      await fsp.mkdir(safeDir, { recursive: true })
      await fsp.writeFile(path.join(safeDir, 'ok.txt'), 'ok')

      const unsafeTarget = path.join(outside, 'nope')
      await fsp.mkdir(unsafeTarget, { recursive: true })

      for (let i = 0; i < 32; i++) {
        const isSafe = i % 2 === 0
        const linkName = `fuzz-${i}-${crypto.randomBytes(4).toString('hex')}`
        const linkPath = path.join(sandbox, linkName)

        if (isSafe) {
          await fsp.symlink(safeDir, linkPath)
        } else {
          await fsp.symlink(unsafeTarget, linkPath)
        }

        const target = path.join(linkPath, 'ok.txt')

        if (isSafe) {
          const result = await resolveBoundaryPath({
            absolutePath: target,
            rootPath: sandbox,
            intent: 'read',
            boundaryLabel: 'sandbox root',
          })
          expect(result.exists).toBe(true)
        } else {
          await expect(
            resolveBoundaryPath({
              absolutePath: target,
              rootPath: sandbox,
              intent: 'read',
              boundaryLabel: 'sandbox root',
            })
          ).rejects.toThrow(/escapes sandbox root/)
        }
      }
    })
  })
})

// ---------------------------------------------------------------------------
// 3. Hardlink tests
// ---------------------------------------------------------------------------

describe('hardlink checks', () => {
  it('allows a normal file (nlink=1)', async () => {
    const filePath = path.join(sandbox, 'normal.txt')
    await fsp.writeFile(filePath, 'content')

    const resolved = await resolveBoundaryPath({
      absolutePath: filePath,
      rootPath: sandbox,
      intent: 'read',
      boundaryLabel: 'sandbox root',
    })

    await expect(
      assertNoHardlinkedFinalPath({
        absolutePath: filePath,
        boundaryLabel: 'sandbox root',
        resolvedPath: resolved,
      })
    ).resolves.toBeUndefined()
  })

  it('rejects a hard-linked file (nlink>1)', async () => {
    const filePath = path.join(sandbox, 'original.txt')
    await fsp.writeFile(filePath, 'content')

    const hardlinkPath = path.join(sandbox, 'hardlink.txt')
    await fsp.link(filePath, hardlinkPath)

    const resolved = await resolveBoundaryPath({
      absolutePath: hardlinkPath,
      rootPath: sandbox,
      intent: 'read',
      boundaryLabel: 'sandbox root',
    })

    await expect(
      assertNoHardlinkedFinalPath({
        absolutePath: hardlinkPath,
        boundaryLabel: 'sandbox root',
        resolvedPath: resolved,
      })
    ).rejects.toThrow(/Hard-linked file.*escapes sandbox root/)
  })

  it('allows a non-existent file', async () => {
    const filePath = path.join(sandbox, 'ghost.txt')

    const resolved = await resolveBoundaryPath({
      absolutePath: filePath,
      rootPath: sandbox,
      intent: 'read',
      boundaryLabel: 'sandbox root',
    })

    await expect(
      assertNoHardlinkedFinalPath({
        absolutePath: filePath,
        boundaryLabel: 'sandbox root',
        resolvedPath: resolved,
      })
    ).resolves.toBeUndefined()
  })

  it('allows hard-linked file when allowFinalHardlinkForUnlink is true', async () => {
    const filePath = path.join(sandbox, 'original.txt')
    await fsp.writeFile(filePath, 'content')

    const hardlinkPath = path.join(sandbox, 'hardlink.txt')
    await fsp.link(filePath, hardlinkPath)

    const resolved = await resolveBoundaryPath({
      absolutePath: hardlinkPath,
      rootPath: sandbox,
      intent: 'delete',
      boundaryLabel: 'sandbox root',
    })

    await expect(
      assertNoHardlinkedFinalPath({
        absolutePath: hardlinkPath,
        boundaryLabel: 'sandbox root',
        resolvedPath: resolved,
        policy: { allowFinalHardlinkForUnlink: true },
      })
    ).resolves.toBeUndefined()
  })

  it('sync version rejects hard-linked file', () => {
    const filePath = path.join(sandbox, 'original.txt')
    fs.writeFileSync(filePath, 'content')

    const hardlinkPath = path.join(sandbox, 'hardlink.txt')
    fs.linkSync(filePath, hardlinkPath)

    const resolved = resolveBoundaryPathSync({
      absolutePath: hardlinkPath,
      rootPath: sandbox,
      intent: 'read',
      boundaryLabel: 'sandbox root',
    })

    expect(() =>
      assertNoHardlinkedFinalPathSync({
        absolutePath: hardlinkPath,
        boundaryLabel: 'sandbox root',
        resolvedPath: resolved,
      })
    ).toThrow(/Hard-linked file.*escapes sandbox root/)
  })
})

// ---------------------------------------------------------------------------
// 4. Combined guard (assertNoPathAliasEscape)
// ---------------------------------------------------------------------------

describe('assertNoPathAliasEscape (combined)', () => {
  it('allows normal file inside sandbox', async () => {
    const filePath = path.join(sandbox, 'safe.txt')
    await fsp.writeFile(filePath, 'safe')

    const result = await assertNoPathAliasEscape({
      absolutePath: filePath,
      rootPath: sandbox,
      intent: 'read',
      boundaryLabel: 'sandbox root',
    })

    expect(result.exists).toBe(true)
    expect(result.kind).toBe('file')
  })

  it('rejects ../ path traversal', async () => {
    const escaped = path.resolve(sandbox, '..', 'outside', 'secret.txt')

    await expect(
      assertNoPathAliasEscape({
        absolutePath: escaped,
        rootPath: sandbox,
        intent: 'read',
        boundaryLabel: 'sandbox root',
      })
    ).rejects.toThrow(/escapes sandbox root/)
  })

  it('rejects absolute path outside root', async () => {
    const outsidePath = path.join(outside, 'nope.txt')
    await fsp.writeFile(outsidePath, 'nope')

    await expect(
      assertNoPathAliasEscape({
        absolutePath: outsidePath,
        rootPath: sandbox,
        intent: 'read',
        boundaryLabel: 'sandbox root',
      })
    ).rejects.toThrow(/escapes sandbox root/)
  })

  it('allows normal sub-path', async () => {
    const subDir = path.join(sandbox, 'a', 'b', 'c')
    await fsp.mkdir(subDir, { recursive: true })
    const filePath = path.join(subDir, 'deep.txt')
    await fsp.writeFile(filePath, 'deep')

    const result = await assertNoPathAliasEscape({
      absolutePath: filePath,
      rootPath: sandbox,
      intent: 'read',
      boundaryLabel: 'sandbox root',
    })

    expect(result.exists).toBe(true)
    expect(result.kind).toBe('file')
  })

  it('sync version works for normal files', () => {
    const filePath = path.join(sandbox, 'sync-safe.txt')
    fs.writeFileSync(filePath, 'ok')

    const result = assertNoPathAliasEscapeSync({
      absolutePath: filePath,
      rootPath: sandbox,
      intent: 'read',
      boundaryLabel: 'sandbox root',
    })

    expect(result.exists).toBe(true)
    expect(result.kind).toBe('file')
  })

  it('sync version rejects ../ traversal', () => {
    const escaped = path.resolve(sandbox, '..', 'outside', 'secret.txt')

    expect(() =>
      assertNoPathAliasEscapeSync({
        absolutePath: escaped,
        rootPath: sandbox,
        intent: 'read',
        boundaryLabel: 'sandbox root',
      })
    ).toThrow(/escapes sandbox root/)
  })
})

// ---------------------------------------------------------------------------
// 5. resolveBoundaryPath – missing path handling
// ---------------------------------------------------------------------------

describe('resolveBoundaryPath missing paths', () => {
  it('returns kind=missing for non-existent file inside sandbox', async () => {
    const result = await resolveBoundaryPath({
      absolutePath: path.join(sandbox, 'no', 'such', 'file.txt'),
      rootPath: sandbox,
      intent: 'create',
      boundaryLabel: 'sandbox root',
    })

    expect(result.exists).toBe(false)
    expect(result.kind).toBe('missing')
  })

  it('sync returns kind=missing for non-existent file inside sandbox', () => {
    const result = resolveBoundaryPathSync({
      absolutePath: path.join(sandbox, 'nope.txt'),
      rootPath: sandbox,
      intent: 'create',
      boundaryLabel: 'sandbox root',
    })

    expect(result.exists).toBe(false)
    expect(result.kind).toBe('missing')
  })
})
