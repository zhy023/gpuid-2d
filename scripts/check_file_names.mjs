/**
 * 校验 src 下所有文件名符合 snake_case（小写 + 下划线）。
 * 用法：node scripts/check_file_names.mjs
 */
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const TARGET_DIR = 'src'
// 允许：app.tsx、user_card.tsx、api_client.test.ts、hero.png
const VALID_FILE_NAME = /^[a-z0-9]+(?:_[a-z0-9]+)*(?:\.[a-z0-9]+)*$/

async function collectFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(fullPath)))
    } else {
      files.push(fullPath)
    }
  }

  return files
}

const files = await collectFiles(TARGET_DIR)
const invalid = files.filter((file) => !VALID_FILE_NAME.test(path.basename(file)))

if (invalid.length > 0) {
  console.error('以下文件名不符合「小写 + 下划线」规范：')
  for (const file of invalid) {
    console.error(`  ${file}`)
  }
  console.error(`\n共 ${invalid.length} 个文件需重命名，例如 user_card.tsx、api_client.ts。`)
  process.exit(1)
}

console.log(`文件名检查通过（${files.length} 个文件）`)
