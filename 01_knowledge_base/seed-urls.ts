/**
 * カタログ詳細ページ URL 一覧 (ローダー)
 *
 * クロール対象サイトの実URLは `README_INTERNAL.md` (gitignore対象、リポジトリには
 * 含まれない) の "## Seed URLs" セクション(YAMLコードブロック)に定義する。
 * `README.md` の同名セクションをコピーして作成すること。
 *
 * Managed Knowledge Base の Web Crawler データソースでは `seedUrls` が
 * 最大10件までしか指定できないため、実際のクロール起点には
 * `siteMapUrls` を使う (create-data-source.ts 参照)。このファイルが読み込む
 * URLリストは以下の用途で使う:
 *   1. README でどのページを対象にしているかを明示する
 *   2. inclusionPatterns / exclusionPatterns の正規表現を導出する根拠にする
 *   3. ingestion完了後に「正しく取り込まれたか」を検証する際の期待値にする
 */

import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import { extractSection, extractFencedCodeBlock } from '../shared/markdown-sections.js'

interface SeedUrlsConfig {
  catalogDetailUrls: string[]
  brokenDetailUrls: string[]
  chartDemoCandidateUrls: string[]
  sitemapUrl: string
  catalogInclusionPattern: string
}

const SEED_URLS_HEADING = '## Seed URLs'
const HERE = dirname(fileURLToPath(import.meta.url))
const CONFIG_PATH = join(HERE, 'README_INTERNAL.md')
const EXAMPLE_PATH = join(HERE, 'README.md')

function loadSeedUrlsConfig(): SeedUrlsConfig {
  if (!existsSync(CONFIG_PATH)) {
    throw new Error(
      `${CONFIG_PATH} が見つかりません。${EXAMPLE_PATH} の "${SEED_URLS_HEADING}" セクションをコピーし、対象サイトのURLを設定してください。`,
    )
  }
  const raw = readFileSync(CONFIG_PATH, 'utf-8')
  try {
    return parse(extractFencedCodeBlock(extractSection(raw, SEED_URLS_HEADING))) as SeedUrlsConfig
  } catch {
    throw new Error(
      `${CONFIG_PATH} に "${SEED_URLS_HEADING}" セクションが見つかりません。${EXAMPLE_PATH} の同名セクションをコピーし、対象サイトのURLを設定してください。`,
    )
  }
}

const config = loadSeedUrlsConfig()

/** 詳細ページのURL一覧 */
export const CATALOG_DETAIL_URLS: string[] = config.catalogDetailUrls

/**
 * 現時点で404になっているページ。sitemap.xmlには含まれているが実体が無いため、
 * Web Crawlerの exclusionPatterns で明示的に除外する(取り込み時のノイズ・
 * ingestion失敗を避けるため)。
 */
export const BROKEN_DETAIL_URLS: string[] = config.brokenDetailUrls

/** 数値データが豊富で、グラフ生成デモに向いているページ */
export const CHART_DEMO_CANDIDATE_URLS: string[] = config.chartDemoCandidateUrls

/** サイトマップURL(実際のWeb Crawlerシードとして使用) */
export const SITEMAP_URL = config.sitemapUrl

/** siteMapUrls 経由で取り込む対象を詳細ページのみに絞る inclusionPatterns */
export const CATALOG_INCLUSION_PATTERN = config.catalogInclusionPattern

/** BROKEN_DETAIL_URLS を取り込み対象から除外する exclusionPatterns */
export const CATALOG_EXCLUSION_PATTERNS: string[] = BROKEN_DETAIL_URLS.map(
  (url) => `^${url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`,
)
