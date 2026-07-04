/**
 * Markdown Section Extractor
 *
 * README.md / README_INTERNAL.md に埋め込んだ設定(YAML/箇条書き)を、
 * 見出し単位・コードブロック単位で取り出すためのヘルパー。
 */

/** 指定した見出し(例: "## Seed URLs")配下の本文を、次の同階層以上の見出しの手前まで取り出す */
export function extractSection(markdown: string, heading: string): string {
  const lines = markdown.split('\n')
  const level = heading.match(/^#+/)?.[0].length
  if (!level) throw new Error(`見出しは "#" から始まる必要があります: ${heading}`)

  const startIdx = lines.findIndex((line) => line.trim() === heading)
  if (startIdx === -1) {
    throw new Error(`見出し "${heading}" が見つかりません`)
  }

  let endIdx = lines.length
  for (let i = startIdx + 1; i < lines.length; i++) {
    const match = lines[i].match(/^(#+)\s/)
    if (match && match[1].length <= level) {
      endIdx = i
      break
    }
  }
  return lines.slice(startIdx + 1, endIdx).join('\n').trim()
}

/** 本文中の最初のフェンス付きコードブロック(```)の中身を取り出す */
export function extractFencedCodeBlock(markdown: string): string {
  const match = markdown.match(/```[^\n]*\n([\s\S]*?)```/)
  if (!match) {
    throw new Error('コードブロック (```) が見つかりません')
  }
  return match[1]
}
