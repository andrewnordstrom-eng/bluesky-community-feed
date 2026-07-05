import { Fragment, createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { parseLegalDocumentContent } from "./legal-docs"

const FILE_PATH = "/tmp/legal.md"

function parseFixture(markdown: string) {
  return parseLegalDocumentContent(markdown, FILE_PATH)
}

function renderSectionBody(markdown: string, sectionIndex: number): string {
  const document = parseFixture(markdown)
  const section = document.sections[sectionIndex]
  if (!section) {
    throw new Error(`Missing section at index ${sectionIndex}; sections=${document.sections.length}`)
  }
  return renderToStaticMarkup(createElement(Fragment, null, section.body))
}

describe("parseLegalDocumentContent", () => {
  it("parses title, metadata, preface, sections, lists, and inline tokens", () => {
    const document = parseFixture(`# Example Terms

**Last Updated:** January 1, 2026

Preface with **bold** and \`code\`.

## Account Rules

- Keep a valid handle.
- Contact support@example.com when blocked.

1. Read the terms.
2. Accept the terms.
`)

    expect(document.title).toBe("Example Terms")
    expect(document.lastUpdated).toBe("January 1, 2026")
    expect(document.sections.map((section) => section.id)).toEqual(["document-status", "account-rules"])

    const prefaceMarkup = renderToStaticMarkup(createElement(Fragment, null, document.sections[0].body))
    const sectionMarkup = renderToStaticMarkup(createElement(Fragment, null, document.sections[1].body))
    expect(prefaceMarkup).toContain("<strong")
    expect(prefaceMarkup).toContain("<code")
    expect(sectionMarkup).toContain('href="mailto:support@example.com"')
    expect(sectionMarkup).toContain("<ol")
  })

  it("keeps trailing URL punctuation outside links and links mid-sentence email addresses", () => {
    const markup = renderSectionBody(`# Privacy Policy

**Last Updated:** January 1, 2026

## Contact

Visit https://example.com!? Another link https://example.org? Email privacy@example.com? for help.
`, 0)

    expect(markup).toContain('<a href="https://example.com"')
    expect(markup).toContain("https://example.com</a>!?")
    expect(markup).toContain('<a href="https://example.org"')
    expect(markup).toContain("https://example.org</a>?")
    expect(markup).toContain('href="mailto:privacy@example.com"')
    expect(markup).toContain("privacy@example.com</a>?")
    expect(markup).toContain("Email ")
    expect(markup).toContain(" for help.")
  })

  it("links inline tokens inside bold text", () => {
    const markup = renderSectionBody(`# Privacy Policy

**Last Updated:** January 1, 2026

## Contact

**Contact legal@example.com?, read https://example.com/docs!?, and keep \`receipt-id\`.**
`, 0)

    expect(markup).toContain("<strong")
    expect(markup).toContain('href="mailto:legal@example.com"')
    expect(markup).toContain("legal@example.com</a>?,")
    expect(markup).toContain('href="https://example.com/docs"')
    expect(markup).toContain("https://example.com/docs</a>!?,")
    expect(markup).toContain("<code")
    expect(markup).toContain("receipt-id")
  })

  it("leaves malformed bold markers as plain text", () => {
    const markup = renderSectionBody(`# Privacy Policy

**Last Updated:** January 1, 2026

## Contact

Empty **** and open **bold text should remain readable.
`, 0)

    expect(markup).not.toContain("<strong")
    expect(markup).toContain("Empty ****")
    expect(markup).toContain("open **bold text should remain readable.")
  })

  it("parses valid inline bold between words", () => {
    const markup = renderSectionBody(`# Privacy Policy

**Last Updated:** January 1, 2026

## Contact

word**bold**word
`, 0)

    expect(markup).toContain("word<strong")
    expect(markup).toContain(">bold</strong>word")
  })

  it("leaves adjacent and odd bold markers as plain text", () => {
    const markup = renderSectionBody(`# Privacy Policy

**Last Updated:** January 1, 2026

## Contact

Adjacent **a****b** and odd ***triple** markers remain literal.
`, 0)

    expect(markup).not.toContain("<strong")
    expect(markup).toContain("**a****b**")
    expect(markup).toContain("***triple**")
  })

  it("leaves bold markers containing asterisks as plain text", () => {
    const markup = renderSectionBody(`# Privacy Policy

**Last Updated:** January 1, 2026

## Contact

Literal **Use \`a*b\` carefully** remains readable.
`, 0)

    expect(markup).not.toContain("<strong")
    expect(markup).toContain("**Use ")
    expect(markup).toContain("<code")
    expect(markup).toContain("a*b")
    expect(markup).toContain(" carefully**")
  })

  it("parses tables followed immediately by paragraph text", () => {
    const markup = renderSectionBody(`# Privacy Policy

**Last Updated:** January 1, 2026

## Data Uses

| Data | Use |
| --- | --- |
| Vote | Community tally |
Paragraph after table without a blank line.
`, 0)

    expect(markup).toContain("<table")
    expect(markup).toContain("<th")
    expect(markup).toContain("Community tally")
    expect(markup).toContain("Paragraph after table without a blank line.")
  })

  it("parses lists followed immediately by paragraph text", () => {
    const markup = renderSectionBody(`# Privacy Policy

**Last Updated:** January 1, 2026

## Data Uses

- First list item.
- Second list item.
Paragraph after list without a blank line.
`, 0)
    const listEndIndex = markup.indexOf("</ul>")
    const paragraphIndex = markup.indexOf("Paragraph after list without a blank line.")

    expect(markup).toContain("<ul")
    expect(markup).toContain("Second list item.")
    expect(listEndIndex).toBeGreaterThan(-1)
    expect(paragraphIndex).toBeGreaterThan(listEndIndex)
    expect(markup.slice(listEndIndex)).toContain("<p")
  })

  it("rejects duplicate section IDs", () => {
    expect(() => {
      parseFixture(`# Terms

**Last Updated:** January 1, 2026

## Account Rules
First.

## Account Rules
Second.
`)
    }).toThrow(/duplicate section id/)
  })

  it("rejects headings that normalize to the same section ID", () => {
    expect(() => {
      parseFixture(`# Terms

**Last Updated:** January 1, 2026

## Account Rules!
First.

## Account Rules?
Second.
`)
    }).toThrow(/duplicate section id/)
  })

  it("rejects documents without an H1 title", () => {
    expect(() => {
      parseFixture(`**Last Updated:** January 1, 2026

## Rules
Body.
`)
    }).toThrow(/missing an H1 title/)
  })

  it("rejects documents without Last Updated metadata", () => {
    expect(() => {
      parseFixture(`# Terms

## Rules
Body.
`)
    }).toThrow(/missing Last Updated metadata/)
  })

  it("rejects headings that normalize to an empty section ID", () => {
    expect(() => {
      parseFixture(`# Terms

**Last Updated:** January 1, 2026

## !!!
Body.
`)
    }).toThrow(/invalid heading/)
  })
})
