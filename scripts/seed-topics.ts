/**
 * Seed Topics Script
 *
 * Populates the topic_catalog table with 25 initial topics.
 * Idempotent — uses ON CONFLICT (slug) DO UPDATE so it can be re-run safely.
 *
 * Usage: npm run seed-topics
 */

import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

interface TopicSeed {
  slug: string;
  name: string;
  description: string;
  parentSlug: string | null;
  terms: string[];
  contextTerms: string[];
  antiTerms: string[];
}

const TOPICS: TopicSeed[] = [
  {
    slug: 'software-development',
    name: 'Software Development',
    description: 'Programming, coding, developer tools, and software engineering',
    parentSlug: null,
    terms: [
      'programming', 'coding', 'software', 'developer', 'debug',
      'refactor', 'git', 'github', 'gitlab', 'pull request', 'merge', 'commit',
      'IDE', 'vscode', 'compiler', 'interpreter', 'algorithm', 'data structure',
      'API', 'SDK', 'framework', 'library', 'dependency', 'package manager',
    ],
    contextTerms: [
      'python', 'javascript', 'typescript', 'java', 'csharp', 'golang',
      'repository', 'branch', 'deploy', 'CI/CD', 'lint', 'test suite',
    ],
    antiTerms: ['television', 'tv show', 'episode', 'schedule', 'channel'],
  },
  {
    slug: 'ai-machine-learning',
    name: 'AI & Machine Learning',
    description: 'Artificial intelligence, machine learning, LLMs, and neural networks',
    parentSlug: null,
    terms: [
      'AI', 'artificial intelligence', 'machine learning', 'deep learning', 'neural network',
      'LLM', 'GPT', 'transformer', 'inference', 'fine-tune',
      'prompt engineering', 'embedding', 'vector', 'classification', 'NLP',
      'computer vision', 'reinforcement learning', 'generative', 'diffusion',
    ],
    contextTerms: [
      'dataset', 'epoch', 'loss function', 'gradient', 'tensor', 'pytorch',
      'tensorflow', 'huggingface', 'benchmark', 'evaluation', 'hallucination',
      'alignment', 'safety', 'weights',
    ],
    antiTerms: ['artificial turf', 'artificial flavor'],
  },
  {
    slug: 'open-source',
    name: 'Open Source',
    description: 'Free and open source software, licensing, and community projects',
    parentSlug: null,
    terms: [
      'open source', 'FOSS', 'OSS', 'free software', 'MIT license', 'GPL',
      'Apache license', 'BSD', 'copyleft', 'permissive license', 'maintainer',
      'contributor', 'upstream', 'downstream', 'community project',
    ],
    contextTerms: [
      'github', 'gitlab', 'sourceforge', 'contribution', 'issue tracker',
      'release', 'changelog', 'roadmap', 'governance', 'foundation',
    ],
    antiTerms: ['open source of income', 'open source of water'],
  },
  {
    slug: 'decentralized-social',
    name: 'Decentralized Social',
    description: 'Bluesky, AT Protocol, fediverse, Mastodon, and decentralized networks',
    parentSlug: null,
    terms: [
      'atproto', 'AT Protocol', 'fediverse', 'mastodon', 'activitypub',
      'decentralized', 'federation', 'PDS', 'relay', 'appview', 'firehose',
      'DID', 'custom feed', 'labeler', 'moderation service',
      'self-hosting', 'nostr', 'threads federation',
    ],
    contextTerms: [
      'social media', 'protocol', 'identity', 'interoperability', 'data portability',
      'algorithm transparency', 'content moderation', 'user control',
    ],
    antiTerms: ['decentralized finance', 'DeFi', 'cryptocurrency'],
  },
  {
    slug: 'web-development',
    name: 'Web Development',
    description: 'Frontend, backend, HTML, CSS, React, and web applications',
    parentSlug: null,
    terms: [
      'HTML', 'CSS', 'JavaScript', 'TypeScript', 'React', 'Vue', 'Svelte',
      'Angular', 'Next.js', 'frontend', 'backend', 'fullstack', 'responsive',
      'webpack', 'vite', 'tailwind', 'web app', 'SPA', 'SSR', 'SSG',
      'REST', 'GraphQL', 'websocket', 'DOM', 'browser',
    ],
    contextTerms: [
      'node.js', 'express', 'fastify', 'deno', 'bun', 'npm', 'yarn',
      'component', 'hook', 'state management', 'routing', 'middleware',
    ],
    antiTerms: ['spider web', 'web of lies', 'cobweb'],
  },
  {
    slug: 'data-science',
    name: 'Data Science',
    description: 'Data analysis, statistics, visualization, and data engineering',
    parentSlug: null,
    terms: [
      'data science', 'data analysis', 'statistics', 'visualization', 'pandas',
      'numpy', 'jupyter', 'notebook', 'dataset', 'ETL', 'data pipeline',
      'dashboard', 'metrics', 'analytics', 'SQL', 'database', 'warehouse',
      'BigQuery', 'Snowflake', 'dbt', 'data engineering',
    ],
    contextTerms: [
      'matplotlib', 'seaborn', 'plotly', 'tableau', 'PowerBI', 'R language',
      'regression', 'correlation', 'hypothesis', 'p-value', 'A/B test',
    ],
    antiTerms: ['data plan', 'cellular data', 'data usage'],
  },
  {
    slug: 'cybersecurity',
    name: 'Cybersecurity',
    description: 'Security, privacy, encryption, vulnerabilities, and infosec',
    parentSlug: null,
    terms: [
      'cybersecurity', 'privacy', 'encryption', 'vulnerability',
      'CVE', 'exploit', 'malware', 'ransomware', 'phishing', 'firewall',
      'penetration testing', 'pentest', 'zero-day', 'patch', 'infosec',
      'OWASP', 'authentication', 'authorization', 'MFA', 'SSO',
    ],
    contextTerms: [
      'threat', 'attack vector', 'audit', 'compliance', 'SOC', 'SIEM',
      'incident response', 'forensics', 'CTF', 'bug bounty', 'red team',
    ],
    antiTerms: ['job security', 'financial security', 'security guard'],
  },
  {
    slug: 'devops-infrastructure',
    name: 'DevOps & Infrastructure',
    description: 'Docker, Kubernetes, CI/CD, cloud computing, and infrastructure',
    parentSlug: null,
    terms: [
      'devops', 'docker', 'kubernetes', 'k8s', 'CI/CD', 'terraform',
      'ansible', 'AWS', 'Azure', 'GCP', 'cloud', 'serverless', 'lambda',
      'container', 'orchestration', 'monitoring', 'observability', 'prometheus',
      'grafana', 'nginx', 'load balancer', 'CDN', 'infrastructure as code',
    ],
    contextTerms: [
      'deploy', 'pipeline', 'staging', 'production', 'rollback', 'uptime',
      'SLA', 'horizontal scaling', 'microservices', 'service mesh', 'helm',
    ],
    antiTerms: ['weather cloud', 'cloud nine'],
  },
  {
    slug: 'systems-programming',
    name: 'Systems Programming',
    description: 'Rust, C, C++, low-level programming, compilers, and operating systems',
    parentSlug: null,
    terms: [
      'Rust', 'C language', 'C++', 'systems programming', 'low-level', 'compiler',
      'linker', 'assembly', 'kernel', 'operating system', 'memory management',
      'pointer', 'LLVM', 'embedded', 'RTOS', 'bare metal', 'firmware',
      'concurrency', 'mutex', 'borrow checker',
    ],
    contextTerms: [
      'cargo', 'crate', 'unsafe', 'zero-cost abstraction', 'ownership',
      'stack', 'heap', 'segfault', 'buffer overflow', 'ABI',
    ],
    antiTerms: ['rust stain', 'rust removal', 'rusty nail'],
  },
  {
    slug: 'mobile-development',
    name: 'Mobile Development',
    description: 'iOS, Android, Swift, Kotlin, React Native, and mobile apps',
    parentSlug: null,
    terms: [
      'iOS', 'Android', 'Swift', 'Kotlin', 'React Native', 'Flutter',
      'mobile app', 'App Store', 'Google Play', 'Xcode', 'Android Studio',
      'SwiftUI', 'Jetpack Compose', 'Expo', 'Capacitor', 'Ionic',
      'push notification', 'app development', 'mobile UI',
    ],
    contextTerms: [
      'smartphone', 'tablet', 'wearable', 'widget', 'deep link',
      'app review', 'TestFlight', 'beta testing', 'responsive design',
    ],
    antiTerms: ['mobile home', 'mobile phone plan'],
  },
  {
    slug: 'gaming',
    name: 'Gaming',
    description: 'Video games, game development, indie games, and gaming culture',
    parentSlug: null,
    terms: [
      'gaming', 'video game', 'indie game', 'game dev', 'Unity', 'Unreal',
      'Godot', 'Steam', 'PlayStation', 'Xbox', 'Nintendo', 'Switch',
      'RPG', 'FPS', 'MMORPG', 'esports', 'speedrun', 'modding',
      'pixel art', 'game jam', 'ludum dare',
    ],
    contextTerms: [
      'gameplay', 'level design', 'shader', 'sprite', 'tilemap',
      'controller', 'multiplayer', 'co-op', 'roguelike', 'metroidvania',
    ],
    antiTerms: ['gaming the system', 'gaming commission'],
  },
  {
    slug: 'design-ux',
    name: 'Design & UX',
    description: 'UI/UX design, Figma, accessibility, typography, and design systems',
    parentSlug: null,
    terms: [
      'design', 'UX', 'UI', 'user experience', 'user interface', 'Figma',
      'Sketch', 'wireframe', 'prototype', 'accessibility', 'a11y',
      'typography', 'color palette', 'design system', 'component library',
      'usability testing', 'user research', 'information architecture',
    ],
    contextTerms: [
      'heuristic', 'personas', 'user flow', 'interaction design',
      'visual hierarchy', 'whitespace', 'responsive', 'dark mode',
      'design token', 'Storybook',
    ],
    antiTerms: ['interior design', 'fashion design', 'intelligent design'],
  },
  {
    slug: 'science-research',
    name: 'Science & Research',
    description: 'Academic research, scientific papers, studies, and peer review',
    parentSlug: null,
    terms: [
      'research', 'science', 'study', 'paper', 'peer review', 'journal',
      'preprint', 'arXiv', 'hypothesis', 'experiment', 'methodology',
      'replication', 'meta-analysis', 'systematic review', 'citation',
      'academic', 'laboratory', 'findings', 'evidence-based',
    ],
    contextTerms: [
      'abstract', 'conclusion', 'control group', 'sample size', 'p-value',
      'confidence interval', 'principal investigator', 'grant', 'NIH', 'NSF',
    ],
    antiTerms: ['research my options', 'do your own research conspiracy'],
  },
  {
    slug: 'dogs-pets',
    name: 'Dogs & Pets',
    description: 'Dogs, puppies, corgis, pets, animal rescue, and veterinary care',
    parentSlug: null,
    terms: [
      'dog', 'puppy', 'corgi', 'pet', 'rescue', 'adoption', 'shelter',
      'veterinarian', 'vet', 'breed', 'good boy', 'good girl', 'pupper',
      'doggo', 'cat', 'kitten', 'bird', 'hamster', 'ferret', 'rabbit',
      'pet owner', 'animal welfare', 'spay', 'neuter',
    ],
    contextTerms: [
      'walk', 'treat', 'fetch', 'leash', 'collar', 'grooming', 'training',
      'obedience', 'agility', 'kibble', 'raw diet',
    ],
    antiTerms: ['pet peeve', 'teacher\'s pet', 'pet project'],
  },
  {
    slug: 'climate-environment',
    name: 'Climate & Environment',
    description: 'Climate change, sustainability, renewable energy, and conservation',
    parentSlug: null,
    terms: [
      'climate change', 'global warming', 'sustainability', 'renewable energy',
      'solar', 'wind power', 'carbon', 'emissions', 'greenhouse gas',
      'conservation', 'biodiversity', 'recycling', 'electric vehicle', 'EV',
      'net zero', 'Paris Agreement', 'IPCC', 'fossil fuel', 'deforestation',
    ],
    contextTerms: [
      'carbon footprint', 'sequestration', 'offset', 'permafrost', 'methane',
      'sea level', 'drought', 'wildfire', 'extreme weather', 'ecosystem',
    ],
    antiTerms: ['business climate', 'political climate', 'climate of fear'],
  },
  {
    slug: 'space-astronomy',
    name: 'Space & Astronomy',
    description: 'NASA, rockets, telescopes, planets, and the cosmos',
    parentSlug: null,
    terms: [
      'space', 'NASA', 'SpaceX', 'rocket', 'telescope', 'astronomy',
      'planet', 'Mars', 'moon', 'satellite', 'orbit', 'ISS',
      'James Webb', 'JWST', 'exoplanet', 'galaxy', 'nebula', 'cosmos',
      'astronaut', 'launch', 'starship', 'artemis',
    ],
    contextTerms: [
      'mission', 'payload', 'trajectory', 'light year', 'parsec',
      'black hole', 'supernova', 'red dwarf', 'solar system', 'astrophysics',
    ],
    antiTerms: ['keyboard space', 'office space', 'parking space'],
  },
  {
    slug: 'politics-governance',
    name: 'Politics & Governance',
    description: 'Government, policy, elections, democracy, and civic engagement',
    parentSlug: null,
    terms: [
      'politics', 'government', 'policy', 'election', 'democracy', 'voting',
      'legislation', 'Congress', 'parliament', 'senate', 'representative',
      'regulation', 'law', 'rights', 'constitution', 'bipartisan',
      'campaign', 'ballot', 'civic', 'protest',
    ],
    contextTerms: [
      'bill', 'amendment', 'filibuster', 'executive order', 'judicial',
      'lobbying', 'PAC', 'grassroots', 'gerrymandering', 'redistricting',
    ],
    antiTerms: ['office politics', 'workplace politics'],
  },
  {
    slug: 'art-creative',
    name: 'Art & Creative',
    description: 'Digital art, illustration, creative work, photography, and visual arts',
    parentSlug: null,
    terms: [
      'art', 'digital art', 'illustration', 'drawing', 'painting', 'photography',
      'creative', 'artist', 'portfolio', 'commission', 'gallery', 'exhibition',
      'sculpture', 'printmaking', 'watercolor', 'sketch', 'concept art',
      'visual art', 'generative art', 'NFT art',
    ],
    contextTerms: [
      'canvas', 'medium', 'composition', 'palette', 'brush', 'procreate',
      'photoshop', 'lightroom', 'DSLR', 'aperture', 'shutter speed',
    ],
    antiTerms: ['art of the deal', 'state of the art', 'art deco building'],
  },
  {
    slug: 'music',
    name: 'Music',
    description: 'Songs, albums, musicians, concerts, and music production',
    parentSlug: null,
    terms: [
      'music', 'song', 'album', 'musician', 'concert', 'band', 'singer',
      'guitar', 'piano', 'drums', 'vinyl', 'Spotify', 'playlist',
      'producer', 'recording', 'studio', 'mix', 'master', 'beat',
      'synth', 'DJ', 'live performance',
    ],
    contextTerms: [
      'chord', 'melody', 'harmony', 'tempo', 'BPM', 'DAW', 'Ableton',
      'Logic Pro', 'sample', 'loop', 'EQ', 'reverb', 'compressor',
    ],
    antiTerms: ['face the music', 'music to my ears'],
  },
  {
    slug: 'books-reading',
    name: 'Books & Reading',
    description: 'Books, reading, literature, libraries, and publishing',
    parentSlug: null,
    terms: [
      'book', 'reading', 'novel', 'fiction', 'nonfiction', 'author',
      'library', 'bookstore', 'publisher', 'manuscript', 'writing',
      'literary', 'chapter', 'bestseller', 'kindle', 'ebook',
      'audiobook', 'book club', 'review', 'recommendation',
    ],
    contextTerms: [
      'genre', 'fantasy', 'sci-fi', 'mystery', 'thriller', 'memoir',
      'biography', 'poetry', 'anthology', 'hardcover', 'paperback',
    ],
    antiTerms: ['book a flight', 'booking', 'book it', 'by the book'],
  },
  {
    slug: 'health-fitness',
    name: 'Health & Fitness',
    description: 'Exercise, nutrition, mental health, wellness, and personal fitness',
    parentSlug: null,
    terms: [
      'health', 'fitness', 'exercise', 'workout', 'gym', 'running',
      'nutrition', 'diet', 'mental health', 'wellness', 'yoga', 'meditation',
      'strength training', 'cardio', 'marathon', 'weightlifting', 'CrossFit',
      'sleep', 'recovery', 'stretching',
    ],
    contextTerms: [
      'calories', 'macros', 'protein', 'hydration', 'BMI', 'heart rate',
      'VO2 max', 'personal record', 'PR', 'rep', 'set', 'progressive overload',
    ],
    antiTerms: ['health of the economy', 'financial health'],
  },
  {
    slug: 'cooking-food',
    name: 'Cooking & Food',
    description: 'Recipes, restaurants, cooking, baking, and food culture',
    parentSlug: null,
    terms: [
      'cooking', 'recipe', 'baking', 'food', 'restaurant', 'chef',
      'kitchen', 'meal prep', 'ingredient', 'cuisine', 'flavor',
      'fermentation', 'sourdough', 'grilling', 'sous vide', 'instant pot',
      'air fryer', 'vegan', 'vegetarian', 'gluten-free',
    ],
    contextTerms: [
      'oven', 'sauté', 'simmer', 'dice', 'mince', 'seasoning',
      'spice', 'umami', 'Michelin', 'brunch', 'comfort food',
    ],
    antiTerms: ['cooking the books', 'what\'s cooking'],
  },
  {
    slug: 'startups-business',
    name: 'Startups & Business',
    description: 'Entrepreneurship, startups, venture capital, and business strategy',
    parentSlug: null,
    terms: [
      'startup', 'entrepreneur', 'business', 'venture capital', 'VC', 'funding',
      'seed round', 'Series A', 'IPO', 'revenue', 'growth', 'product market fit',
      'pivot', 'MVP', 'founder', 'co-founder', 'SaaS', 'B2B', 'B2C',
      'bootstrapped', 'accelerator', 'incubator',
    ],
    contextTerms: [
      'pitch deck', 'valuation', 'burn rate', 'runway', 'ARR', 'MRR',
      'churn', 'acquisition', 'merger', 'board', 'equity', 'stock option',
    ],
    antiTerms: ['monkey business', 'show business', 'funny business'],
  },
  {
    slug: 'education',
    name: 'Education',
    description: 'Teaching, learning, universities, online courses, and students',
    parentSlug: null,
    terms: [
      'education', 'teaching', 'learning', 'university', 'college', 'school',
      'student', 'professor', 'course', 'curriculum', 'lecture', 'seminar',
      'online learning', 'MOOC', 'Coursera', 'edtech', 'tutoring',
      'scholarship', 'degree', 'graduation',
    ],
    contextTerms: [
      'syllabus', 'assignment', 'exam', 'GPA', 'thesis', 'dissertation',
      'pedagogy', 'classroom', 'enrollment', 'accreditation',
    ],
    antiTerms: ['school of fish', 'old school'],
  },
  {
    slug: 'news-journalism',
    name: 'News & Journalism',
    description: 'News reporting, journalism, media, and press freedom',
    parentSlug: null,
    terms: [
      'news', 'journalism', 'journalist', 'reporter', 'media', 'press',
      'headline', 'breaking news', 'investigative', 'editorial', 'opinion',
      'newsroom', 'publication', 'press freedom', 'fact check', 'source',
      'correspondent', 'byline', 'exclusive', 'scoop',
    ],
    contextTerms: [
      'coverage', 'beat', 'deadline', 'editor', 'story', 'dispatch',
      'interview', 'press conference', 'wire service', 'AP', 'Reuters',
    ],
    antiTerms: ['no news is good news', 'news feed algorithm'],
  },
];

async function seedTopics(): Promise<void> {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    let upsertCount = 0;

    for (const topic of TOPICS) {
      await pool.query(
        `INSERT INTO topic_catalog (slug, name, description, parent_slug, terms, context_terms, anti_terms)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (slug) DO UPDATE SET
           name = EXCLUDED.name,
           description = EXCLUDED.description,
           parent_slug = EXCLUDED.parent_slug,
           terms = EXCLUDED.terms,
           context_terms = EXCLUDED.context_terms,
           anti_terms = EXCLUDED.anti_terms,
           updated_at = NOW()`,
        [
          topic.slug,
          topic.name,
          topic.description,
          topic.parentSlug,
          topic.terms,
          topic.contextTerms,
          topic.antiTerms,
        ]
      );
      upsertCount++;
    }

    // Verify count
    const result = await pool.query('SELECT COUNT(*) FROM topic_catalog WHERE is_active = TRUE');
    const activeCount = parseInt(result.rows[0].count);

    console.log(`Seeded ${upsertCount} topics (${activeCount} active in catalog)`);
  } catch (err) {
    console.error('Failed to seed topics:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

seedTopics();
