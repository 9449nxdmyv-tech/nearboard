/**
 * @file linkClassifier.ts
 * @description Advanced classification for regular links (blog posts, tutorials, documentation, etc.)
 *              Complements contentDetection.ts by providing fine-grained link categorization.
 * 
 * Classification tiers:
 *   1. Content Purpose (tutorial, reference, news, opinion, research, entertainment)
 *   2. Topic Domain (technology, business, health, science, arts, etc.)
 *   3. Time Sensitivity (evergreen, trending, time-sensitive)
 *   4. Depth Level (introductory, intermediate, advanced, expert)
 */

import { extractDomain, extractDomain as extractDomainFromUrl } from './contentDetection';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Link purpose classification */
export type LinkPurpose =
	| 'tutorial'      // How-to guides, step-by-step instructions
	| 'documentation' // API docs, reference manuals
	| 'news'          // News articles, announcements
	| 'blog'          // Opinion pieces, personal blogs
	| 'research'      // Academic papers, studies, data
	| 'entertainment' // Fun content, memes, viral
	| 'product'       // Product pages, reviews, comparisons
	| 'landing'       // Marketing pages, sign-ups
	| 'social'        // Social media posts, profiles
	| 'tool'          // Web apps, calculators, utilities
	| 'forum'         // Discussions, Q&A, threads
	| 'portfolio'     // Work samples, case studies
	| 'unknown';

/** Topic domain classification */
export type TopicDomain =
	| 'technology'
	| 'business'
	| 'science'
	| 'health'
	| 'arts'
	| 'sports'
	| 'politics'
	| 'education'
	| 'lifestyle'
	| 'finance'
	| 'travel'
	| 'food'
	| 'entertainment'
	| 'mixed'
	| 'unknown';

/** Time sensitivity */
export type TimeSensitivity = 'evergreen' | 'trending' | 'time-sensitive';

/** Depth level */
export type DepthLevel = 'introductory' | 'intermediate' | 'advanced' | 'expert' | 'unknown';

/** Complete link classification result */
export interface LinkClassification {
	/** Primary purpose */
	purpose: LinkPurpose;
	/** Topic domain */
	topic: TopicDomain;
	/** Time sensitivity */
	timeSensitivity: TimeSensitivity;
	/** Estimated depth level */
	depth: DepthLevel;
	/** Confidence score (0-1) */
	confidence: number;
	/** Signals that contributed to classification */
	signals: ClassificationSignal[];
	/** Suggested board keywords */
	suggestedKeywords: string[];
}

/** Individual classification signal */
export interface ClassificationSignal {
	type: string;
	strength: number;
	description: string;
}

// ─── Domain Classification Maps ──────────────────────────────────────────────

/** Domains that strongly indicate specific purposes */
const PURPOSE_DOMAINS: Record<string, LinkPurpose> = {
	// Tutorials
	'freecodecamp.org': 'tutorial',
	'codecademy.com': 'tutorial',
	'khanacademy.org': 'tutorial',
	'coursera.org': 'tutorial',
	'udemy.com': 'tutorial',
	'youtube.com': 'tutorial',
	'youtu.be': 'tutorial',
	
	// Documentation
	'developer.mozilla.org': 'documentation',
	'docs.microsoft.com': 'documentation',
	'readthedocs.io': 'documentation',
	'npmjs.com': 'documentation',
	'pkg.go.dev': 'documentation',
	
	// News
	'techcrunch.com': 'news',
	'theverge.com': 'news',
	'wired.com': 'news',
	'arstechnica.com': 'news',
	'reuters.com': 'news',
	'apnews.com': 'news',
	
	// Research
	'arxiv.org': 'research',
	'pubmed.ncbi.nlm.nih.gov': 'research',
	'google.com/scholar': 'research',
	'researchgate.net': 'research',
	
	// Tools
	'github.com': 'tool',
	'gitlab.com': 'tool',
	'codesandbox.io': 'tool',
	'replit.com': 'tool',
	'figma.com': 'tool',
	
	// Forums
	'stackoverflow.com': 'forum',
	'reddit.com': 'forum',
	'discord.com': 'forum',
	'quora.com': 'forum',
	
	// Blogs
	'medium.com': 'blog',
	'substack.com': 'blog',
	'dev.to': 'blog',
	'hashnode.com': 'blog',
};

/** URL path patterns that indicate purpose */
const PURPOSE_PATH_PATTERNS: Array<{ pattern: RegExp; purpose: LinkPurpose; strength: number }> = [
	// Tutorials
	{ pattern: /\/tutorial/i, purpose: 'tutorial', strength: 0.9 },
	{ pattern: /\/how-to/i, purpose: 'tutorial', strength: 0.9 },
	{ pattern: /\/guide/i, purpose: 'tutorial', strength: 0.8 },
	{ pattern: /\/learn/i, purpose: 'tutorial', strength: 0.8 },
	{ pattern: /\/course/i, purpose: 'tutorial', strength: 0.85 },
	{ pattern: /\/lesson/i, purpose: 'tutorial', strength: 0.85 },
	{ pattern: /\/walkthrough/i, purpose: 'tutorial', strength: 0.9 },
	{ pattern: /\/step-by-step/i, purpose: 'tutorial', strength: 0.95 },
	
	// Documentation
	{ pattern: /\/docs/i, purpose: 'documentation', strength: 0.95 },
	{ pattern: /\/documentation/i, purpose: 'documentation', strength: 0.95 },
	{ pattern: /\/api\//i, purpose: 'documentation', strength: 0.85 },
	{ pattern: /\/reference/i, purpose: 'documentation', strength: 0.8 },
	
	// News
	{ pattern: /\/news/i, purpose: 'news', strength: 0.9 },
	{ pattern: /\/article/i, purpose: 'news', strength: 0.7 },
	{ pattern: /\/story/i, purpose: 'news', strength: 0.7 },
	{ pattern: /\/breaking/i, purpose: 'news', strength: 0.95 },
	
	// Blog
	{ pattern: /\/blog/i, purpose: 'blog', strength: 0.9 },
	{ pattern: /\/post/i, purpose: 'blog', strength: 0.7 },
	{ pattern: /\/opinion/i, purpose: 'blog', strength: 0.85 },
	
	// Research
	{ pattern: /\/paper/i, purpose: 'research', strength: 0.9 },
	{ pattern: /\/study/i, purpose: 'research', strength: 0.85 },
	{ pattern: /\/research/i, purpose: 'research', strength: 0.9 },
	
	// Product
	{ pattern: /\/product/i, purpose: 'product', strength: 0.85 },
	{ pattern: /\/review/i, purpose: 'product', strength: 0.8 },
	{ pattern: /\/pricing/i, purpose: 'product', strength: 0.75 },
];

/** Keywords that indicate topic domains */
const TOPIC_KEYWORDS: Record<TopicDomain, string[]> = {
	technology: ['software', 'code', 'programming', 'tech', 'digital', 'ai', 'machine learning', 'app', 'web', 'mobile', 'cloud', 'devops', 'cybersecurity'],
	business: ['startup', 'entrepreneur', 'marketing', 'sales', 'management', 'strategy', 'finance', 'investment', 'economy', 'market'],
	science: ['research', 'study', 'experiment', 'discovery', 'physics', 'chemistry', 'biology', 'astronomy', 'scientific'],
	health: ['medical', 'healthcare', 'wellness', 'fitness', 'nutrition', 'disease', 'treatment', 'doctor', 'hospital', 'medicine'],
	arts: ['art', 'design', 'music', 'film', 'literature', 'photography', 'creative', 'artist', 'gallery', 'exhibition'],
	sports: ['football', 'basketball', 'soccer', 'baseball', 'tennis', 'athlete', 'team', 'game', 'championship', 'olympics'],
	politics: ['government', 'policy', 'election', 'congress', 'senate', 'legislation', 'political', 'vote', 'democracy'],
	education: ['school', 'university', 'college', 'student', 'teacher', 'learning', 'curriculum', 'academic', 'degree'],
	lifestyle: ['fashion', 'beauty', 'home', 'garden', 'parenting', 'relationship', 'self-improvement', 'hobby'],
	finance: ['banking', 'investment', 'stock', 'crypto', 'currency', 'tax', 'insurance', 'budget', 'money', 'trading'],
	travel: ['travel', 'vacation', 'destination', 'hotel', 'flight', 'tourism', 'adventure', 'trip', 'journey'],
	food: ['recipe', 'restaurant', 'cooking', 'cuisine', 'chef', 'food', 'dining', 'culinary', 'meal'],
	entertainment: ['movie', 'tv', 'show', 'celebrity', 'gaming', 'streaming', 'concert', 'festival', 'fun'],
	mixed: [],
	unknown: []
};

/** TLD patterns that indicate time sensitivity */
const TIME_SENSITIVITY_PATTERNS: Array<{ pattern: RegExp; sensitivity: TimeSensitivity }> = [
	{ pattern: /\/\d{4}\/\d{2}\/\d{2}/, sensitivity: 'time-sensitive' }, // Date in URL
	{ pattern: /\/breaking/i, sensitivity: 'time-sensitive' },
	{ pattern: /\/live/i, sensitivity: 'time-sensitive' },
	{ pattern: /\/today/i, sensitivity: 'time-sensitive' },
	{ pattern: /\/trending/i, sensitivity: 'trending' },
	{ pattern: /\/viral/i, sensitivity: 'trending' },
];

// ─── Classification Functions ────────────────────────────────────────────────

/**
 * Classify a link URL by purpose, topic, and characteristics.
 * 
 * @param url - URL to classify
 * @param title - Optional page title for better classification
 * @param description - Optional page description for better classification
 * @returns Link classification result
 */
export function classifyLink(
	url: string,
	title?: string | null,
	description?: string | null
): LinkClassification {
	const signals: ClassificationSignal[] = [];
	let purpose: LinkPurpose = 'unknown';
	let purposeConfidence = 0.3;
	let topic: TopicDomain = 'unknown';
	let topicConfidence = 0.3;
	let timeSensitivity: TimeSensitivity = 'evergreen';
	let depth: DepthLevel = 'unknown';
	
	const domain = extractDomainFromUrl(url);
	let pathname = '';
	
	try {
		pathname = new URL(url).pathname;
	} catch {
		// Invalid URL
	}
	
	const fullText = `${title ?? ''} ${description ?? ''}`.toLowerCase();
	
	// ── Step 1: Domain-based purpose detection ─────────────────────────────
	
	if (domain) {
		const domainPurpose = PURPOSE_DOMAINS[domain];
		if (domainPurpose) {
			signals.push({
				type: 'domain_purpose',
				strength: 0.85,
				description: `Known ${domainPurpose} domain: ${domain}`
			});
			purpose = domainPurpose;
			purposeConfidence = 0.85;
		}
	}
	
	// ── Step 2: Path pattern detection ──────────────────────────────────────
	
	for (const { pattern, purpose: pathPurpose, strength } of PURPOSE_PATH_PATTERNS) {
		if (pattern.test(pathname)) {
			signals.push({
				type: 'url_pattern',
				strength,
				description: `Path pattern indicates ${pathPurpose}`
			});
			
			if (strength > purposeConfidence) {
				purpose = pathPurpose;
				purposeConfidence = strength;
			}
		}
	}
	
	// ── Step 3: Topic detection from URL and metadata ───────────────────────
	
	const topicSignals = detectTopic(domain, pathname, fullText);
	topic = topicSignals.topic;
	topicConfidence = topicSignals.confidence;
	signals.push(...topicSignals.signals);
	
	// ── Step 4: Time sensitivity detection ──────────────────────────────────
	
	for (const { pattern, sensitivity } of TIME_SENSITIVITY_PATTERNS) {
		if (pattern.test(pathname) || pattern.test(fullText)) {
			signals.push({
				type: 'time_pattern',
				strength: 0.7,
				description: `URL/content suggests ${sensitivity} content`
			});
			timeSensitivity = sensitivity;
			break;
		}
	}
	
	// ── Step 5: Depth level estimation ──────────────────────────────────────
	
	depth = estimateDepth(pathname, title, description);
	if (depth !== 'unknown') {
		signals.push({
			type: 'depth_estimation',
			strength: 0.6,
			description: `Content appears to be ${depth}`
		});
	}
	
	// ── Step 6: Generate suggested board keywords ───────────────────────────
	
	const suggestedKeywords = generateSuggestedKeywords(purpose, topic, domain, title);
	
	return {
		purpose,
		topic,
		timeSensitivity,
		depth,
		confidence: (purposeConfidence + topicConfidence) / 2,
		signals,
		suggestedKeywords
	};
}

/**
 * Detect topic domain from URL and content.
 */
function detectTopic(
	domain: string | null,
	pathname: string,
	fullText: string
): { topic: TopicDomain; confidence: number; signals: ClassificationSignal[] } {
	const signals: ClassificationSignal[] = [];
	const topicScores: Record<string, number> = {};
	
	// Check topic keywords in text
	for (const [topicName, keywords] of Object.entries(TOPIC_KEYWORDS)) {
		if (topicName === 'mixed' || topicName === 'unknown') continue;
		
		let score = 0;
		for (const keyword of keywords) {
			if (fullText.includes(keyword.toLowerCase())) {
				score += 0.2;
			}
			if (pathname.includes(keyword.toLowerCase())) {
				score += 0.3;
			}
		}
		
		if (score > 0) {
			topicScores[topicName] = score;
		}
	}
	
	// Domain-based topic detection
	const techDomains = ['github.com', 'stackoverflow.com', 'dev.to', 'medium.com'];
	if (domain && techDomains.includes(domain)) {
		topicScores['technology'] = (topicScores['technology'] ?? 0) + 0.5;
	}
	
	// Find highest scoring topic
	let bestTopic: TopicDomain = 'unknown';
	let bestScore = 0;
	
	for (const [topicName, score] of Object.entries(topicScores)) {
		if (score > bestScore) {
			bestTopic = topicName as TopicDomain;
			bestScore = score;
		}
	}
	
	if (bestScore > 0) {
		signals.push({
			type: 'topic_detection',
			strength: Math.min(bestScore, 1),
			description: `Content appears to be about ${bestTopic}`
		});
	}
	
	// Check for mixed topics
	const topicCount = Object.keys(topicScores).filter(t => topicScores[t] >= 0.3).length;
	if (topicCount > 2) {
		bestTopic = 'mixed';
	}
	
	return {
		topic: bestTopic,
		confidence: Math.min(bestScore, 1),
		signals
	};
}

/**
 * Estimate content depth level.
 */
function estimateDepth(
	pathname: string,
	title?: string | null,
	description?: string | null
): DepthLevel {
	const fullText = `${pathname} ${title ?? ''} ${description ?? ''}`.toLowerCase();
	
	// Introductory indicators
	const introPatterns = [
		/introduction/i, /beginner/i, /getting started/i, /101/i, /basics/i,
		/fundamentals/i, /for beginners/i, /easy/i, /simple/i
	];
	
	// Advanced indicators
	const advancedPatterns = [
		/advanced/i, /expert/i, /deep dive/i, /internals/i, /under the hood/i,
		/optimization/i, /architecture/i, /patterns/i, /best practices/i
	];
	
	// Check for introductory content
	for (const pattern of introPatterns) {
		if (pattern.test(fullText)) return 'introductory';
	}
	
	// Check for advanced content
	for (const pattern of advancedPatterns) {
		if (pattern.test(fullText)) return 'advanced';
	}
	
	// URL path hints
	if (/\/intro/i.test(pathname) || /\/beginner/i.test(pathname)) return 'introductory';
	if (/\/advanced/i.test(pathname) || /\/expert/i.test(pathname)) return 'advanced';
	
	return 'unknown';
}

/**
 * Generate suggested board keywords based on classification.
 */
function generateSuggestedKeywords(
	purpose: LinkPurpose,
	topic: TopicDomain,
	domain: string | null,
	title?: string | null
): string[] {
	const keywords: string[] = [];
	
	// Purpose-based keywords
	const purposeKeywords: Record<LinkPurpose, string[]> = {
		tutorial: ['learn', 'tutorial', 'guide', 'course', 'education'],
		documentation: ['docs', 'reference', 'api', 'manual', 'technical'],
		news: ['news', 'article', 'story', 'update', 'announcement'],
		blog: ['blog', 'post', 'opinion', 'thoughts', 'writing'],
		research: ['research', 'paper', 'study', 'academic', 'data'],
		entertainment: ['fun', 'entertainment', 'media', 'viral', 'interesting'],
		product: ['product', 'shop', 'buy', 'review', 'comparison'],
		landing: ['signup', 'register', 'subscribe', 'download', 'app'],
		social: ['social', 'profile', 'post', 'discussion', 'community'],
		tool: ['tool', 'app', 'utility', 'service', 'platform'],
		forum: ['forum', 'discussion', 'qa', 'question', 'answer', 'thread'],
		portfolio: ['portfolio', 'work', 'project', 'case study', 'showcase'],
		unknown: []
	};
	
	keywords.push(...purposeKeywords[purpose]);
	
	// Topic-based keywords
	if (topic !== 'unknown' && topic !== 'mixed') {
		keywords.push(topic);
	}
	
	// Domain-based keywords
	if (domain) {
		const domainName = domain.replace(/^www\./, '').split('.')[0];
		keywords.push(domainName);
	}
	
	// Title-based keywords
	if (title) {
		// Extract 2-3 key words from title
		const titleWords = title
			.split(/\s+/)
			.filter(w => w.length > 4)
			.slice(0, 3)
			.map(w => w.toLowerCase().replace(/[^a-z0-9]/g, ''));
		keywords.push(...titleWords);
	}
	
	// Remove duplicates and return top 5
	return [...new Set(keywords)].slice(0, 5);
}

/**
 * Get board routing suggestions based on link classification.
 * Returns keywords that should boost board matching scores.
 */
export function getLinkRoutingBoosts(classification: LinkClassification): {
	keywords: string[];
	boardTypeHints: string[];
} {
	const keywords: string[] = [];
	const boardTypeHints: string[] = [];
	
	// Purpose-based board type hints
	switch (classification.purpose) {
		case 'tutorial':
		case 'documentation':
			keywords.push('learning', 'education', 'reference', 'resources');
			boardTypeHints.push('learning', 'reference', 'education');
			break;
		case 'news':
		case 'blog':
			keywords.push('news', 'articles', 'reading', 'current');
			boardTypeHints.push('news', 'reading', 'articles');
			break;
		case 'research':
			keywords.push('research', 'papers', 'academic', 'deep');
			boardTypeHints.push('research', 'academic', 'learning');
			break;
		case 'tool':
			keywords.push('tools', 'resources', 'useful', 'bookmarks');
			boardTypeHints.push('tools', 'resources', 'bookmarks');
			break;
		case 'product':
			// Shopping-oriented vocabulary — was previously bucketed with 'tool'
			// and boosted generic keyword boards like "bookmarks" instead of
			// commerce-oriented boards like "wishlist" or "gifts".
			keywords.push('shopping', 'wishlist', 'wants', 'gifts', 'buy', 'store', 'deals', 'wardrobe');
			boardTypeHints.push('shopping', 'wishlist', 'gifts', 'shop', 'store');
			break;
		case 'entertainment':
			keywords.push('fun', 'entertainment', 'interesting', 'cool');
			boardTypeHints.push('entertainment', 'fun', 'inspiration');
			break;
		case 'forum':
			keywords.push('discussions', 'community', 'qa', 'help');
			boardTypeHints.push('community', 'help', 'discussions');
			break;
	}
	
	// Topic-based board type hints
	if (classification.topic !== 'unknown' && classification.topic !== 'mixed') {
		boardTypeHints.push(classification.topic);
	}
	
	// Time sensitivity affects board choice
	if (classification.timeSensitivity === 'time-sensitive') {
		keywords.push('today', 'current', 'now', 'recent');
		boardTypeHints.push('today', 'daily', 'current');
	} else if (classification.timeSensitivity === 'evergreen') {
		keywords.push('reference', 'permanent', 'keep', 'archive');
		boardTypeHints.push('reference', 'archive', 'resources');
	}
	
	return { keywords, boardTypeHints };
}
