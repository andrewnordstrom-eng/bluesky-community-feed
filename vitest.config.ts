import path from 'node:path';
import { defineConfig } from 'vitest/config';

const webNextMockModules: Record<string, string> = {
  '@/components/ui/button': `
function classNames(...inputs) {
  return inputs
    .flatMap((input) => {
      if (typeof input === 'string') {
        return [input];
      }
      if (Array.isArray(input)) {
        return input.filter((value) => typeof value === 'string');
      }
      return [];
    })
    .filter((input) => input.length > 0)
    .join(' ');
}

function firstChild(children) {
  return Array.isArray(children) ? children[0] : children;
}

function slot(props) {
  const child = firstChild(props.children);
  const slotProps = Object.fromEntries(
    Object.entries(props).filter(([key]) => key !== 'children'),
  );

  if (child === null || typeof child !== 'object' || !('type' in child) || !('props' in child)) {
    return {
      type: 'span',
      props: {
        ...slotProps,
        children: child,
      },
    };
  }

  return {
    type: child.type,
    props: {
      ...child.props,
      ...slotProps,
      className: classNames(slotProps.className, child.props.className),
      children: child.props.children,
    },
  };
}

export function Button(props) {
  const {
    asChild,
    children,
    className: providedClassName,
    variant,
    ...buttonProps
  } = props;
  const variantClassName = variant === 'ghost'
    ? 'hover:bg-accent hover:text-accent-foreground'
    : 'bg-primary text-primary-foreground hover:bg-primary/90';
  const className = classNames(
    'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors',
    variantClassName,
    'h-10 px-4 py-2',
    providedClassName,
  );

  if (asChild === true) {
    return slot({
      ...buttonProps,
      children,
      className,
    });
  }

  return {
    type: 'button',
    props: {
      ...buttonProps,
      className,
      children,
    },
  };
}
`,
  '@/lib/utils': `
export function cn(...inputs) {
  return inputs
    .flatMap((input) => {
      if (typeof input === 'string') {
        return [input];
      }
      if (Array.isArray(input)) {
        return input.filter((value) => typeof value === 'string');
      }
      return [];
    })
    .filter((input) => input.length > 0)
    .join(' ');
}
`,
  'next/link': `
export default function Link(props) {
  const {
    href,
    children,
    ...anchorProps
  } = props;

  return {
    type: 'a',
    props: {
      ...anchorProps,
      href: typeof href === 'string' ? href : href.toString(),
      children,
    },
  };
}
`,
  'next/link.js': `
export { default } from 'next/link';
`,
  'next/image': `
export default function Image(props) {
  return {
    type: 'img',
    props,
  };
}
`,
  'next/image.js': `
export { default } from 'next/image';
`,
  'lucide-react': `
function Icon(props) {
  return {
    type: 'svg',
    props,
  };
}

export const AlertCircle = Icon;
export const ArrowDown = Icon;
export const ArrowRight = Icon;
export const ArrowUp = Icon;
export const Bot = Icon;
export const Check = Icon;
export const ChevronDown = Icon;
export const ExternalLink = Icon;
export const EyeOff = Icon;
export const FileSearch = Icon;
export const Heart = Icon;
export const ListOrdered = Icon;
export const MessageCircle = Icon;
export const Minus = Icon;
export const Play = Icon;
export const Radio = Icon;
export const Repeat2 = Icon;
export const RotateCcw = Icon;
export const ScanSearch = Icon;
export const Search = Icon;
export const SlidersHorizontal = Icon;
export const Users = Icon;
`,
  'react/jsx-runtime': `
export const Fragment = 'fragment';

export function jsx(type, props) {
  return {
    type,
    props: props === null || props === undefined ? {} : props,
  };
}

export const jsxs = jsx;
`,
  'react/jsx-dev-runtime': `
export const Fragment = 'fragment';

export function jsxDEV(type, props) {
  return {
    type,
    props: props === null || props === undefined ? {} : props,
  };
}

export const jsx = jsxDEV;
export const jsxs = jsxDEV;
`,
};

const webNextMockModulePrefix = '\0web-next-test-mock:';

function resolveWebNextMockSource(source: string): string | null {
  if (source in webNextMockModules) {
    return source;
  }

  const normalizedSource = source.replaceAll('\\', '/');

  if (
    normalizedSource.endsWith('/web-next/components/ui/button')
    || normalizedSource.endsWith('/web-next/components/ui/button.tsx')
  ) {
    return '@/components/ui/button';
  }

  if (
    normalizedSource.endsWith('/web-next/lib/utils')
    || normalizedSource.endsWith('/web-next/lib/utils.ts')
  ) {
    return '@/lib/utils';
  }

  return null;
}

export default defineConfig({
  plugins: [
    {
      name: 'web-next-root-test-mocks',
      enforce: 'pre',
      resolveId(source: string) {
        const mockSource = resolveWebNextMockSource(source);

        if (mockSource !== null) {
          return `${webNextMockModulePrefix}${mockSource}`;
        }

        return null;
      },
      load(id: string) {
        if (!id.startsWith(webNextMockModulePrefix)) {
          return null;
        }

        const source = id.slice(webNextMockModulePrefix.length);
        return webNextMockModules[source] ?? null;
      },
    },
  ],
  oxc: false,
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'react',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'web-next'),
    },
  },
  test: {
    environment: 'node',
  },
});
