#!/usr/bin/env npx tsx
/**
 * Chart Agent のローカル動作確認スクリプト
 *
 * 01_knowledge_base のセットアップ済みKnowledge Baseを検索し、matplotlibで
 * グラフを生成する。生成された画像は ./output/chart-<timestamp>.png に保存する。
 *
 * デフォルトの依頼内容は `README_INTERNAL.md` (gitignore対象) の "## Sample Request"
 * セクションから読み込む。`README.md` の同名セクションをコピーして作成すること。
 *
 * (01_knowledge_base 側でグラフ化に向いたページを選んでいる場合は
 * 01_knowledge_base/README_INTERNAL.md の "## Seed URLs" の chartDemoCandidateUrls を参照)
 *
 * Usage:
 *   npx tsx 02_chart_agent/graph-agent.ts
 *   npx tsx 02_chart_agent/graph-agent.ts "観光業向けGX・DX統合支援サービスの導入1年目と3年目の削減時間を比較するグラフを作って"
 */

import { Command } from 'commander'
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ChartAgent } from './chart-agent/chart-agent.js'
import { extractSection } from '../shared/markdown-sections.js'

const SAMPLE_REQUEST_HEADING = '## Sample Request'
const HERE = dirname(fileURLToPath(import.meta.url))
const SAMPLE_REQUEST_PATH = join(HERE, 'README_INTERNAL.md')
const SAMPLE_REQUEST_EXAMPLE_PATH = join(HERE, 'README.md')

function loadDefaultRequest(): string {
  if (!existsSync(SAMPLE_REQUEST_PATH)) {
    throw new Error(
      `${SAMPLE_REQUEST_PATH} が見つかりません。${SAMPLE_REQUEST_EXAMPLE_PATH} の "${SAMPLE_REQUEST_HEADING}" セクションをコピーして` +
        '依頼内容を設定するか、依頼内容を引数で直接指定してください。',
    )
  }
  let section: string
  try {
    section = extractSection(readFileSync(SAMPLE_REQUEST_PATH, 'utf-8'), SAMPLE_REQUEST_HEADING)
  } catch {
    throw new Error(
      `${SAMPLE_REQUEST_PATH} に "${SAMPLE_REQUEST_HEADING}" セクションが見つかりません。${SAMPLE_REQUEST_EXAMPLE_PATH} の同名セクションをコピーして` +
        '依頼内容を設定するか、依頼内容を引数で直接指定してください。',
    )
  }
  return section
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#') && !line.startsWith('>'))
    .join('\n')
}

async function main() {
  const program = new Command()
    .argument('[request]', 'グラフ作成の依頼内容(日本語)')
    .parse()

  const [requestArg] = program.args
  const request = requestArg ?? loadDefaultRequest()

  console.log(`依頼: ${request}\n`)

  const agent = new ChartAgent()
  const result = await agent.handleRequest(request)

  console.log('\n--- 回答 ---')
  console.log(result.text)

  if (result.chartBase64) {
    const outputDir = join(HERE, 'output')
    mkdirSync(outputDir, { recursive: true })
    const outputPath = join(outputDir, `chart-${Date.now()}.png`)
    writeFileSync(outputPath, Buffer.from(result.chartBase64, 'base64'))
    console.log(`\nグラフ画像を保存しました: ${outputPath}`)
  } else {
    console.log('\nグラフ画像は生成されませんでした。')
  }
}

main().catch((e) => {
  console.error('Chart Agentの実行に失敗しました:', e)
  process.exit(1)
})
