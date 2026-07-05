import fs from "node:fs"
import path from "node:path"
import { Fragment, cache, type ReactNode } from "react"
import type { LegalSection } from "@/components/legal-layout"

type LegalDocumentKind = "tos" | "privacy"

interface LegalDocument {
  title: string
  lastUpdated: string
  sections: LegalSection[]
}

class LegalDocumentError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "LegalDocumentError"
  }
}

const LEGAL_FILENAMES: Record<LegalDocumentKind, string> = {
  tos: "TERMS_OF_SERVICE.md",
  privacy: "PRIVACY_POLICY.md",
}

const INLINE_TOKEN_PATTERN = /(\*\*[^*]+\*\*|`[^`]+`|https?:\/\/[^\s)]+|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,})/g
const TRAILING_LINK_PUNCTUATION_PATTERN = /[.,;]+$/

export const getLegalDocument = cache((kind: LegalDocumentKind): LegalDocument => {
  const filename = LEGAL_FILENAMES[kind]
  const filePath = path.resolve(process.cwd(), "..", "legal", filename)

  if (!fs.existsSync(filePath)) {
    throw new LegalDocumentError(`Legal document file does not exist: ${filePath}`)
  }

  const content = fs.readFileSync(filePath, "utf8")
  const lines = content.split(/\r?\n/)
  const title = getTitle(lines, filePath)
  const lastUpdated = getLastUpdated(lines, filePath)
  const sections = getSections(lines, filePath)

  return { title, lastUpdated, sections }
})

function getTitle(lines: string[], filePath: string): string {
  const titleLine = lines.find((line) => line.startsWith("# "))
  if (!titleLine) {
    throw new LegalDocumentError(`Legal document is missing an H1 title: ${filePath}`)
  }
  return titleLine.replace(/^#\s+/, "").trim()
}

function getLastUpdated(lines: string[], filePath: string): string {
  const lastUpdatedLine = lines.find((line) => line.startsWith("**Last Updated:**"))
  if (!lastUpdatedLine) {
    throw new LegalDocumentError(`Legal document is missing Last Updated metadata: ${filePath}`)
  }
  return lastUpdatedLine.replace("**Last Updated:**", "").trim()
}

function getSections(lines: string[], filePath: string): LegalSection[] {
  const sections: LegalSection[] = []
  const sectionIds = new Set<string>()
  const prefaceLines: string[] = []
  let currentHeading: string | null = null
  let currentLines: string[] = []

  for (const line of lines) {
    if (line.startsWith("# ")) {
      continue
    }

    if (line.startsWith("## ")) {
      pushSection(sections, sectionIds, currentHeading, currentLines, filePath)
      currentHeading = line.replace(/^##\s+/, "").trim()
      currentLines = []
      continue
    }

    if (currentHeading) {
      currentLines.push(line)
      continue
    }

    const trimmed = line.trim()
    if (trimmed !== "" && trimmed !== "---" && !trimmed.startsWith("**Last Updated:**")) {
      prefaceLines.push(line)
    }
  }

  if (prefaceLines.length > 0) {
    const prefaceId = "document-status"
    if (sectionIds.has(prefaceId)) {
      throw new LegalDocumentError(`Legal document has a duplicate section id in ${filePath}: ${prefaceId}`)
    }
    sectionIds.add(prefaceId)
    sections.unshift({
      id: prefaceId,
      heading: "Document status",
      body: <>{renderBlocks(prefaceLines)}</>,
    })
  }

  pushSection(sections, sectionIds, currentHeading, currentLines, filePath)

  if (sections.length === 0) {
    throw new LegalDocumentError(`Legal document has no sections: ${filePath}`)
  }

  return sections
}

function pushSection(
  sections: LegalSection[],
  sectionIds: Set<string>,
  heading: string | null,
  lines: string[],
  filePath: string
): void {
  if (!heading) {
    return
  }

  const id = toSectionId(heading, filePath)
  if (sectionIds.has(id)) {
    throw new LegalDocumentError(`Legal document has a duplicate section id in ${filePath}: ${id}`)
  }
  sectionIds.add(id)

  sections.push({
    id,
    heading,
    body: <>{renderBlocks(lines)}</>,
  })
}

function toSectionId(heading: string, filePath: string): string {
  const id = heading
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")

  if (!id) {
    throw new LegalDocumentError(`Legal document section has an invalid heading in ${filePath}: ${heading}`)
  }

  return id
}

function renderBlocks(lines: string[]): ReactNode[] {
  const blocks: ReactNode[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index]
    const trimmed = line.trim()

    if (trimmed === "" || trimmed === "---") {
      index += 1
      continue
    }

    if (trimmed.startsWith("### ")) {
      blocks.push(
        <h3 key={`h3-${index}`} className="mt-6 mb-3 text-base font-semibold text-foreground">
          {parseInline(trimmed.replace(/^###\s+/, ""))}
        </h3>
      )
      index += 1
      continue
    }

    if (isTableStart(lines, index)) {
      const tableLines: string[] = []
      while (index < lines.length && lines[index].trim().startsWith("|")) {
        tableLines.push(lines[index])
        index += 1
      }
      blocks.push(renderTable(tableLines, `table-${index}`))
      continue
    }

    if (trimmed.startsWith("- ")) {
      const items: string[] = []
      while (index < lines.length && lines[index].trim().startsWith("- ")) {
        items.push(lines[index].trim().replace(/^-\s+/, ""))
        index += 1
      }
      blocks.push(renderUnorderedList(items, `ul-${index}`))
      continue
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = []
      while (index < lines.length && /^\d+\.\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^\d+\.\s+/, ""))
        index += 1
      }
      blocks.push(renderOrderedList(items, `ol-${index}`))
      continue
    }

    const paragraphLines: string[] = []
    while (index < lines.length && isParagraphLine(lines[index])) {
      paragraphLines.push(lines[index].trim())
      index += 1
    }
    const paragraph = paragraphLines.join(" ")
    if (paragraph) {
      blocks.push(
        <p key={`p-${index}`} className="mb-4 text-sm leading-[1.75] text-foreground/65 last:mb-0">
          {parseInline(paragraph)}
        </p>
      )
    } else {
      blocks.push(
        <p key={`p-${index}`} className="mb-4 text-sm leading-[1.75] text-foreground/65 last:mb-0">
          {parseInline(trimmed)}
        </p>
      )
      index += 1
    }
  }

  return blocks
}

function isParagraphLine(line: string): boolean {
  const trimmed = line.trim()
  return (
    trimmed !== "" &&
    trimmed !== "---" &&
    !trimmed.startsWith("### ") &&
    !trimmed.startsWith("- ") &&
    !trimmed.startsWith("|") &&
    !/^\d+\.\s+/.test(trimmed)
  )
}

function isTableStart(lines: string[], index: number): boolean {
  const currentLine = lines[index]?.trim() ?? ""
  const nextLine = lines[index + 1]?.trim() ?? ""
  return currentLine.startsWith("|") && /^\|[\s:-]+\|/.test(nextLine)
}

function renderTable(lines: string[], key: string): ReactNode {
  const header = parseTableRow(lines[0])
  const rows = lines.slice(2).map(parseTableRow)

  return (
    <div key={key} className="mb-5 overflow-x-auto rounded-xl border border-border bg-card">
      <table className="w-full min-w-[620px] border-collapse text-left text-sm">
        <thead className="bg-biscuit/50">
          <tr>
            {header.map((cell, cellIndex) => (
              <th key={`${key}-th-${cellIndex}`} className="border-b border-border px-4 py-3 font-semibold text-foreground/80">
                {parseInline(cell)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={`${key}-row-${rowIndex}`} className="border-b border-border/60 last:border-b-0">
              {row.map((cell, cellIndex) => (
                <td key={`${key}-cell-${rowIndex}-${cellIndex}`} className="px-4 py-3 text-foreground/65 align-top">
                  {parseInline(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function parseTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim())
}

function renderUnorderedList(items: string[], key: string): ReactNode {
  return (
    <ul key={key} className="mb-4 flex flex-col gap-1.5">
      {items.map((item, index) => (
        <li key={`${key}-${index}`} className="flex items-start gap-2 text-sm leading-relaxed text-foreground/65">
          <span className="mt-[0.4rem] h-1.5 w-1.5 flex-shrink-0 rounded-full bg-primary/50" aria-hidden="true" />
          <span>{parseInline(item)}</span>
        </li>
      ))}
    </ul>
  )
}

function renderOrderedList(items: string[], key: string): ReactNode {
  return (
    <ol key={key} className="mb-4 list-decimal space-y-1.5 pl-5 text-sm leading-relaxed text-foreground/65">
      {items.map((item, index) => (
        <li key={`${key}-${index}`}>{parseInline(item)}</li>
      ))}
    </ol>
  )
}

function parseInline(text: string): ReactNode[] {
  return text.split(INLINE_TOKEN_PATTERN).filter(Boolean).map((part, index) => {
    const key = `${part}-${index}`

    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={key} className="font-semibold text-foreground/85">
          {part.slice(2, -2)}
        </strong>
      )
    }

    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code key={key} className="rounded bg-biscuit px-1.5 py-0.5 font-mono text-xs text-foreground/75">
          {part.slice(1, -1)}
        </code>
      )
    }

    if (part.startsWith("http://") || part.startsWith("https://")) {
      const { linkText, trailingText } = splitTrailingLinkPunctuation(part)

      return (
        <Fragment key={key}>
          <a href={linkText} className="text-primary hover:underline underline-offset-2">
            {linkText}
          </a>
          {trailingText}
        </Fragment>
      )
    }

    const emailParts = splitTrailingLinkPunctuation(part)
    if (/^[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}$/.test(emailParts.linkText)) {
      return (
        <Fragment key={key}>
          <a href={`mailto:${emailParts.linkText}`} className="text-primary hover:underline underline-offset-2">
            {emailParts.linkText}
          </a>
          {emailParts.trailingText}
        </Fragment>
      )
    }

    return part
  })
}

function splitTrailingLinkPunctuation(text: string): { linkText: string; trailingText: string } {
  const match = text.match(TRAILING_LINK_PUNCTUATION_PATTERN)
  if (!match) {
    return { linkText: text, trailingText: "" }
  }

  const trailingText = match[0]
  return {
    linkText: text.slice(0, -trailingText.length),
    trailingText,
  }
}
