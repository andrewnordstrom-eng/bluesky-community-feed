import { describe, expect, it } from 'vitest';
import { DemoCTA, WaitlistCTA } from '../web-next/components/landing-ctas';

type ElementType = string | ((props: ElementProps) => RenderedNode);
type RenderedNode =
  | RenderedElement
  | readonly RenderedNode[]
  | string
  | number
  | boolean
  | null
  | undefined;

interface ElementProps {
  readonly [key: string]: unknown;
  readonly children?: RenderedNode;
}

interface RenderedElement {
  readonly type: ElementType;
  readonly props: ElementProps;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function stringifyAttributeValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (value !== null && value !== undefined && typeof value === 'object' && 'toString' in value) {
    return value.toString();
  }

  return '';
}

function renderAttributes(props: ElementProps): string {
  return Object.entries(props)
    .filter(([key, value]) => key !== 'children' && key !== 'ref' && value !== false && value !== undefined && value !== null)
    .map(([key, value]) => {
      if (value === true) {
        return key;
      }

      return `${key}="${escapeHtml(stringifyAttributeValue(value))}"`;
    })
    .join(' ');
}

function createElement(type: ElementType, props: ElementProps): RenderedElement {
  return {
    type,
    props,
  };
}

function renderToStaticMarkup(node: RenderedNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') {
    return '';
  }

  if (typeof node === 'string' || typeof node === 'number') {
    return escapeHtml(String(node));
  }

  if (Array.isArray(node)) {
    return node.map((child) => renderToStaticMarkup(child)).join('');
  }

  if (typeof node.type === 'function') {
    return renderToStaticMarkup(node.type(node.props));
  }

  const renderedChildren = renderToStaticMarkup(node.props.children);
  const attributes = renderAttributes(node.props);
  const attributePrefix = attributes.length > 0 ? ` ${attributes}` : '';

  return `<${node.type}${attributePrefix}>${renderedChildren}</${node.type}>`;
}

function countMatches(value: string, pattern: RegExp): number {
  return value.match(pattern)?.length ?? 0;
}

describe('web-next landing CTAs', () => {
  it('renders DemoCTA as one demo anchor without a nested button', () => {
    const markup = renderToStaticMarkup(createElement(DemoCTA, { className: 'qa-demo-class' }));

    expect(countMatches(markup, /<a\b/g)).toBe(1);
    expect(markup).toContain('href="/demo"');
    expect(markup).not.toContain('<button');
    expect(markup).toContain('qa-demo-class');
    expect(markup).toContain('inline-flex');
    expect(markup).toContain('rounded-full');
    expect(markup).toContain('bg-primary');
  });

  it('renders WaitlistCTA as one waitlist anchor without a nested button', () => {
    const markup = renderToStaticMarkup(createElement(WaitlistCTA, { className: 'qa-sign-in-class' }));

    expect(countMatches(markup, /<a\b/g)).toBe(1);
    expect(markup).toContain('href="/sign-in"');
    expect(markup).toContain('Join the waitlist');
    expect(markup).not.toContain('<button');
    expect(markup).toContain('qa-sign-in-class');
    expect(markup).toContain('inline-flex');
    expect(markup).toContain('rounded-full');
  });

  it('renders WaitlistCTA with its base classes when no className is passed', () => {
    const markup = renderToStaticMarkup(createElement(WaitlistCTA, {}));

    expect(countMatches(markup, /<a\b/g)).toBe(1);
    expect(markup).toContain('href="/sign-in"');
    expect(markup).toContain('Join the waitlist');
    expect(markup).not.toContain('<button');
    expect(markup).toContain('inline-flex');
    expect(markup).toContain('rounded-full');
  });

  it('keeps required base CTA classes when optional className adds layout tokens', () => {
    const demoMarkup = renderToStaticMarkup(createElement(DemoCTA, { className: 'qa-demo-wide sm:px-8' }));
    const signInMarkup = renderToStaticMarkup(createElement(WaitlistCTA, { className: 'qa-sign-in-wide sm:px-6' }));

    expect(demoMarkup).toContain('qa-demo-wide');
    expect(demoMarkup).toContain('sm:px-8');
    expect(demoMarkup).toContain('inline-flex');
    expect(demoMarkup).toContain('rounded-full');
    expect(demoMarkup).toContain('bg-primary');

    expect(signInMarkup).toContain('qa-sign-in-wide');
    expect(signInMarkup).toContain('sm:px-6');
    expect(signInMarkup).toContain('inline-flex');
    expect(signInMarkup).toContain('rounded-full');
    expect(signInMarkup).toContain('hover:text-foreground');
  });
});
