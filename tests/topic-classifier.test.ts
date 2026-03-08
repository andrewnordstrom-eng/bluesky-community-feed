import { describe, expect, it } from 'vitest';
import { classifyPost } from '../src/scoring/topics/classifier.js';
import type { Topic } from '../src/scoring/topics/taxonomy.js';

// --- Test taxonomy: mirrors seed data for the topics used in tests ---

const testTaxonomy: Topic[] = [
  {
    slug: 'software-development',
    name: 'Software Development',
    description: null,
    parentSlug: null,
    terms: [
      'programming', 'coding', 'software', 'developer', 'code', 'bug', 'debug',
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
    description: null,
    parentSlug: null,
    terms: [
      'AI', 'artificial intelligence', 'machine learning', 'deep learning', 'neural network',
      'LLM', 'GPT', 'transformer', 'training', 'inference', 'model', 'fine-tune',
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
    slug: 'devops-infrastructure',
    name: 'DevOps & Infrastructure',
    description: null,
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
    slug: 'dogs-pets',
    name: 'Dogs & Pets',
    description: null,
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
    antiTerms: ['pet peeve', "teacher's pet", 'pet project'],
  },
  {
    slug: 'decentralized-social',
    name: 'Decentralized Social',
    description: null,
    parentSlug: null,
    terms: [
      'atproto', 'AT Protocol', 'fediverse', 'mastodon', 'activitypub',
      'decentralized', 'federation', 'PDS', 'relay', 'appview', 'firehose',
      'DID', 'handle', 'custom feed', 'labeler', 'moderation service',
      'self-hosting', 'nostr', 'threads federation',
    ],
    contextTerms: [
      'social media', 'protocol', 'identity', 'interoperability', 'data portability',
      'algorithm transparency', 'content moderation', 'user control',
    ],
    antiTerms: ['decentralized finance', 'DeFi', 'cryptocurrency'],
  },
  {
    slug: 'open-source',
    name: 'Open Source',
    description: null,
    parentSlug: null,
    terms: [
      'open source', 'FOSS', 'OSS', 'free software', 'MIT license', 'GPL',
      'Apache license', 'BSD', 'copyleft', 'permissive license', 'maintainer',
      'contributor', 'upstream', 'downstream', 'fork', 'community project',
    ],
    contextTerms: [
      'github', 'gitlab', 'sourceforge', 'contribution', 'issue tracker',
      'release', 'changelog', 'roadmap', 'governance', 'foundation',
    ],
    antiTerms: ['open source of income', 'open source of water'],
  },
];

describe('topic classifier', () => {
  // --- E.1 Basic classification ---
  describe('basic classification', () => {
    it('classifies a Python/Docker post as software-development and devops', () => {
      const result = classifyPost(
        'Just deployed my Python API to production using Docker',
        testTaxonomy
      );
      expect(result.matchedTopics).toContain('software-development');
      expect(result.matchedTopics).toContain('devops-infrastructure');
      expect(result.vector['software-development']).toBeGreaterThan(0);
      expect(result.vector['devops-infrastructure']).toBeGreaterThan(0);
    });

    it('classifies a corgi post as dogs-pets', () => {
      const result = classifyPost(
        'Check out this cute corgi puppy!',
        testTaxonomy
      );
      expect(result.matchedTopics).toContain('dogs-pets');
      expect(result.vector['dogs-pets']).toBeGreaterThan(0);
    });

    it('classifies a transformer paper as ai-machine-learning', () => {
      const result = classifyPost(
        'New paper on transformer architecture for NLP',
        testTaxonomy
      );
      expect(result.matchedTopics).toContain('ai-machine-learning');
      expect(result.vector['ai-machine-learning']).toBeGreaterThan(0);
    });

    it('classifies an AT Protocol post as decentralized-social', () => {
      const result = classifyPost(
        "Bluesky's AT Protocol feed generator is awesome",
        testTaxonomy
      );
      expect(result.matchedTopics).toContain('decentralized-social');
      expect(result.vector['decentralized-social']).toBeGreaterThan(0);
    });

    it('does NOT classify a casual bluesky mention as decentralized-social', () => {
      const result = classifyPost(
        'Just posted on bluesky for the first time',
        testTaxonomy
      );
      // "bluesky" is no longer a primary term — casual platform mentions
      // should not be classified as decentralized social technology
      expect(result.matchedTopics).not.toContain('decentralized-social');
    });

    it('classifies AT Protocol specifics without mentioning bluesky', () => {
      const result = classifyPost(
        'Setting up my own PDS and connecting to the firehose relay',
        testTaxonomy
      );
      // PDS, firehose, relay = 3 primary hits → strong match (Rule 5: bonus)
      expect(result.matchedTopics).toContain('decentralized-social');
      expect(result.vector['decentralized-social']).toBeGreaterThan(0.5);
    });
  });

  // --- E.2 Co-occurrence disambiguation ---
  describe('co-occurrence disambiguation', () => {
    it('gives weak match for ambiguous single term', () => {
      const result = classifyPost('I love programming', testTaxonomy);
      // "programming" alone = 1 primary hit, 0 context → score 0.2
      expect(result.vector['software-development']).toBeDefined();
      expect(result.vector['software-development']).toBeCloseTo(0.2, 1);
    });

    it('gives strong match when context terms confirm topic', () => {
      const result = classifyPost(
        'I love programming in Python and JavaScript',
        testTaxonomy
      );
      expect(result.matchedTopics).toContain('software-development');
      // Should be significantly stronger than the 0.2 weak match
      expect(result.vector['software-development']).toBeGreaterThan(0.5);
    });

    it('does NOT match software-development when anti-terms are present', () => {
      const result = classifyPost(
        'Programming schedule for tonight\'s television lineup',
        testTaxonomy
      );
      // Anti-terms "television" and "schedule" should disqualify with only 1 primary hit
      expect(result.matchedTopics).not.toContain('software-development');
    });
  });

  // --- E.3 Multi-word terms ---
  describe('multi-word terms', () => {
    it('matches multi-word term "machine learning"', () => {
      const result = classifyPost(
        "I'm working on a machine learning model",
        testTaxonomy
      );
      expect(result.matchedTopics).toContain('ai-machine-learning');
    });

    it('matches "pull request" as multi-word term', () => {
      const result = classifyPost(
        'Just submitted a pull request on GitHub',
        testTaxonomy
      );
      // Should match software-development or open-source (both have github/pull request)
      const matched = result.matchedTopics;
      expect(
        matched.includes('software-development') || matched.includes('open-source')
      ).toBe(true);
    });
  });

  // --- E.4 Edge cases ---
  describe('edge cases', () => {
    it('returns empty vector for empty string', () => {
      const result = classifyPost('', testTaxonomy);
      expect(result.vector).toEqual({});
      expect(result.matchedTopics).toEqual([]);
      expect(result.tokenCount).toBe(0);
    });

    it('returns empty vector for URLs and mentions only', () => {
      const result = classifyPost(
        'https://example.com @user.bsky.social',
        testTaxonomy
      );
      expect(result.matchedTopics).toEqual([]);
    });

    it('returns empty vector for non-English text', () => {
      const result = classifyPost(
        '今日はとても良い天気ですね',
        testTaxonomy
      );
      expect(result.matchedTopics).toEqual([]);
    });

    it('handles long post (300 chars) correctly', () => {
      const longPost = 'This is a post about programming and coding with Python and JavaScript. '.repeat(4).trim();
      const result = classifyPost(longPost, testTaxonomy);
      expect(result.matchedTopics).toContain('software-development');
      expect(result.tokenCount).toBeGreaterThan(0);
    });

    it('returns empty vector when no topics match', () => {
      const result = classifyPost(
        'The weather is nice today and I had a lovely breakfast',
        testTaxonomy
      );
      expect(result.matchedTopics).toEqual([]);
      expect(result.vector).toEqual({});
      expect(result.tokenCount).toBeGreaterThan(0);
    });
  });

  // --- E.5 Performance ---
  describe('performance', () => {
    it('classifies 1000 posts in under 2 seconds', () => {
      const posts = [
        'Just deployed my Python API to production using Docker',
        'Check out this cute corgi puppy!',
        'New paper on transformer architecture for NLP',
        "Bluesky's AT Protocol feed generator is awesome",
        'I love programming in Python and JavaScript',
        'Working on a machine learning model for text classification',
        'The weather is nice today',
        'Kubernetes deployment is failing in staging',
        'Just submitted a pull request on GitHub',
        'My dog learned a new trick at obedience training',
      ];

      const start = performance.now();
      for (let i = 0; i < 1000; i++) {
        classifyPost(posts[i % posts.length], testTaxonomy);
      }
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(2000);
    });
  });

  // --- Additional: taxonomy edge cases ---
  describe('taxonomy edge cases', () => {
    it('returns empty result for empty taxonomy', () => {
      const result = classifyPost('Programming in Python', []);
      expect(result.vector).toEqual({});
      expect(result.matchedTopics).toEqual([]);
    });

    it('normalizes scores relative to max', () => {
      // A post strongly matching one topic and weakly matching another
      const result = classifyPost(
        'Deploying Docker containers to Kubernetes with Terraform on AWS',
        testTaxonomy
      );
      // devops should be the strongest match
      expect(result.matchedTopics).toContain('devops-infrastructure');
      expect(result.vector['devops-infrastructure']).toBe(1);
    });
  });
});
