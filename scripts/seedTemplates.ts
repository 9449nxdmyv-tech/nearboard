/**
 * @file seedTemplates.ts
 * @description Seeds the Firestore templates collection with curated templates
 *              containing real links from top websites for each category.
 *              Idempotent — skips templates that already exist.
 *
 * Usage:
 *   npx ts-node --project scripts/tsconfig.json scripts/seedTemplates.ts
 *
 * Requires: GOOGLE_APPLICATION_CREDENTIALS env var or gcloud auth application-default login
 */

import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

if (getApps().length === 0) {
	initializeApp({ projectId: 'nearboard-app' });
}
const db = getFirestore();

const SYSTEM_UID = 'nearboard-system';
const SYSTEM_NAME = 'Nearboard';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fav(domain: string): string {
	return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32`;
}

let idCounter = 0;
function uid(): string {
	return `tpl-${Date.now()}-${++idCounter}`;
}

interface Section {
	title: string;
	contentType: string;
	placeholder: string;
	url?: string;
	description?: string | null;
	image?: string | null;
	domain?: string;
	favicon?: string | null;
	price?: string;
	originalPrice?: string | null;
	items?: { id: string; text: string; completed: boolean }[];
}

function note(title: string, text: string): Section {
	return { title, contentType: 'note', placeholder: text };
}

function link(title: string, url: string, description?: string): Section {
	const domain = new URL(url).hostname.replace(/^www\./, '');
	return {
		title,
		contentType: 'link',
		placeholder: title,
		url,
		description: description ?? null,
		image: null,
		domain,
		favicon: fav(domain)
	};
}

function product(title: string, url: string, price: string): Section {
	const domain = new URL(url).hostname.replace(/^www\./, '');
	return {
		title,
		contentType: 'product',
		placeholder: title,
		url,
		price,
		image: null,
		domain,
		favicon: fav(domain),
		originalPrice: null
	};
}

function list(title: string, items: string[]): Section {
	return {
		title,
		contentType: 'list',
		placeholder: title,
		items: items.map((text) => ({ id: uid(), text, completed: false }))
	};
}

interface Template {
	name: string;
	description: string;
	category: string;
	sections: Section[];
}

// ─── Curated Templates ──────────────────────────────────────────────────────

const TEMPLATES: Template[] = [
	// ═══════════════════════════════════════════════════════════════════════
	// HOUSEHOLD
	// ═══════════════════════════════════════════════════════════════════════
	{
		name: 'Weekly Meal Planner',
		description: 'Plan your weekly meals with recipes from top food sites and a grocery checklist.',
		category: 'household',
		sections: [
			note('Meal Planning Tips', 'Plan meals around seasonal produce. Prep proteins on Sunday. Use leftovers creatively for lunch. Batch cook grains and sauces.'),
			link('Budget Bytes — Meal Prep', 'https://www.budgetbytes.com/category/extra-bytes/budget-friendly-meal-prep/', 'Affordable meal prep ideas and recipes'),
			link('NYT Cooking — Weeknight Dinners', 'https://cooking.nytimes.com/topics/weeknight-dinners', 'Quick and easy weeknight dinner recipes'),
			list('Weekly Grocery List', [
				'Chicken breasts', 'Rice (2 lbs)', 'Broccoli', 'Olive oil',
				'Garlic', 'Onions', 'Canned tomatoes', 'Pasta'
			]),
			link('Serious Eats — Quick Recipes', 'https://www.seriouseats.com/quick-dinner-recipes-5117702', 'Fast dinner recipes from Serious Eats')
		]
	},
	{
		name: 'Home Cleaning Schedule',
		description: 'Stay on top of household chores with a room-by-room cleaning schedule and product links.',
		category: 'household',
		sections: [
			list('Daily Tasks', [
				'Wipe kitchen counters', 'Load/unload dishwasher', 'Quick bathroom wipe',
				'Sweep kitchen floor', 'Tidy living room'
			]),
			list('Weekly Deep Clean', [
				'Vacuum all rooms', 'Mop hard floors', 'Clean bathrooms',
				'Change bed sheets', 'Dust surfaces', 'Clean mirrors'
			]),
			product('Method All-Purpose Cleaner', 'https://www.amazon.com/dp/B00I3E50MK', '$4.99'),
			link('Clean Mama — Cleaning Routines', 'https://cleanmama.com/clean-mama-routine/', 'Simple daily cleaning routine system'),
			note('Cleaning Zones', 'Monday: Kitchen. Tuesday: Bathrooms. Wednesday: Bedrooms. Thursday: Living areas. Friday: Floors & laundry.')
		]
	},
	{
		name: 'Home Maintenance Tracker',
		description: 'Track seasonal home maintenance tasks so nothing falls through the cracks.',
		category: 'household',
		sections: [
			list('Spring Maintenance', [
				'Check smoke detectors', 'Clean gutters', 'Service AC unit',
				'Power wash deck', 'Inspect roof for damage'
			]),
			list('Fall Maintenance', [
				'Winterize pipes', 'Clean chimney', 'Check weatherstripping',
				'Reverse ceiling fans', 'Drain garden hoses'
			]),
			link('This Old House — Maintenance Checklist', 'https://www.thisoldhouse.com/21018361/home-maintenance-checklist', 'Complete seasonal home maintenance guide'),
			note('Emergency Contacts', 'Plumber: ___. Electrician: ___. HVAC: ___. Handyman: ___. Insurance policy #: ___.')
		]
	},

	// ═══════════════════════════════════════════════════════════════════════
	// FAMILY
	// ═══════════════════════════════════════════════════════════════════════
	{
		name: 'Family Activity Ideas',
		description: 'Curated family-friendly activities, outings, and resources for quality time together.',
		category: 'family',
		sections: [
			link('PBS Kids Activities', 'https://pbskids.org/games', 'Educational games and activities for kids'),
			link('National Geographic Kids', 'https://kids.nationalgeographic.com/', 'Explore nature, science, and animals'),
			list('Weekend Activity Ideas', [
				'Family bike ride', 'Board game night', 'Visit the library',
				'Cook dinner together', 'Backyard camping', 'Nature scavenger hunt'
			]),
			link('AllTrails — Family-Friendly Hikes', 'https://www.alltrails.com/', 'Find easy hikes and trails near you'),
			note('Screen-Free Ideas', 'Build a fort with blankets. Have a family art session. Start a garden project. Write letters to grandparents. Put on a play.')
		]
	},
	{
		name: 'Back to School Prep',
		description: 'Everything your family needs to get ready for a new school year.',
		category: 'family',
		sections: [
			list('School Supply Checklist', [
				'Notebooks', 'Pencils & pens', 'Backpack', 'Folders',
				'Calculator', 'Glue sticks', 'Scissors', 'Lunch box'
			]),
			product('JanSport Big Student Backpack', 'https://www.amazon.com/dp/B07MDHQBCP', '$44.99'),
			link('Common Sense Media — Best Learning Apps', 'https://www.commonsensemedia.org/lists/best-learning-apps-for-kids', 'Age-appropriate educational apps reviewed by experts'),
			list('First Week Routine', [
				'Set bedtime alarm', 'Pack lunches night before', 'Lay out clothes',
				'Review school calendar', 'Set up homework station'
			]),
			note('Important Dates', 'First day: ___. Parent-teacher night: ___. Picture day: ___. School breaks: ___.')
		]
	},

	// ═══════════════════════════════════════════════════════════════════════
	// TRIP
	// ═══════════════════════════════════════════════════════════════════════
	{
		name: 'Weekend City Break',
		description: 'Plan a perfect weekend getaway with booking links, packing lists, and travel tips.',
		category: 'trip',
		sections: [
			link('Google Flights', 'https://www.google.com/travel/flights', 'Search and compare flight prices'),
			link('Booking.com', 'https://www.booking.com', 'Find hotels, apartments, and unique stays'),
			list('Weekend Packing Essentials', [
				'Phone charger', 'Comfortable walking shoes', 'Weather-appropriate layers',
				'Toiletries bag', 'Camera', 'Portable battery pack'
			]),
			link('Atlas Obscura — Unusual Places', 'https://www.atlasobscura.com/', 'Discover the world\'s hidden wonders'),
			note('Trip Budget', 'Flights: $___. Hotel: $___. Food: $___/day. Activities: $___. Transport: $___. Total: $___.')
		]
	},
	{
		name: 'Road Trip Planner',
		description: 'Organize an epic road trip with route planning, stops, and car essentials.',
		category: 'trip',
		sections: [
			link('Roadtrippers — Route Planner', 'https://roadtrippers.com/', 'Plan your route with stops and attractions'),
			link('GasBuddy — Fuel Prices', 'https://www.gasbuddy.com/', 'Find the cheapest gas along your route'),
			list('Car Essentials', [
				'First aid kit', 'Jumper cables', 'Tire pressure gauge',
				'Blanket', 'Snacks & water', 'Phone mount', 'Paper maps (backup)'
			]),
			product('Anker Car Phone Mount', 'https://www.amazon.com/dp/B0BYP5P664', '$15.99'),
			list('Pre-Trip Checklist', [
				'Check oil & tire pressure', 'Clean windshield', 'Update GPS/maps offline',
				'Book first night stay', 'Share itinerary with someone'
			])
		]
	},
	{
		name: 'International Travel Checklist',
		description: 'Don\'t forget anything for your international adventure.',
		category: 'trip',
		sections: [
			list('Documents', [
				'Passport (valid 6+ months)', 'Visa if required', 'Travel insurance',
				'Hotel confirmations', 'Emergency contacts card', 'Copies of documents (digital)'
			]),
			link('US State Dept — Travel Advisories', 'https://travel.state.gov/content/travel/en/traveladvisories/traveladvisories.html/', 'Check travel advisories for your destination'),
			link('XE Currency Converter', 'https://www.xe.com/currencyconverter/', 'Convert currencies with live exchange rates'),
			list('Packing List', [
				'Adapter/converter', 'Medications', 'Comfort items for flight',
				'Photocopies of passport', 'Local SIM or eSIM', 'Travel pillow'
			]),
			product('Universal Travel Adapter', 'https://www.amazon.com/dp/B01DJ140LQ', '$12.99')
		]
	},

	// ═══════════════════════════════════════════════════════════════════════
	// TEAM
	// ═══════════════════════════════════════════════════════════════════════
	{
		name: 'Sprint Planning Board',
		description: 'Organize your team sprint with task lists, reference docs, and useful dev tools.',
		category: 'team',
		sections: [
			list('Sprint Backlog', [
				'User story #1 — Login flow', 'User story #2 — Dashboard redesign',
				'Bug fix — payment timeout', 'Tech debt — upgrade dependencies',
				'Write unit tests for API'
			]),
			link('Linear — Project Management', 'https://linear.app/', 'Streamlined issue tracking for software teams'),
			link('GitHub — Pull Requests', 'https://github.com/pulls', 'Review and manage pull requests'),
			note('Sprint Goals', 'Focus: Ship v2.0 login flow. Reduce P1 bugs to zero. Improve test coverage to 80%.'),
			list('Definition of Done', [
				'Code reviewed', 'Tests passing', 'QA approved',
				'Docs updated', 'Deployed to staging'
			])
		]
	},
	{
		name: 'Team Onboarding',
		description: 'Welcome new team members with essential resources and a first-week checklist.',
		category: 'team',
		sections: [
			list('Day 1 Setup', [
				'Get laptop & accounts', 'Set up dev environment', 'Join Slack channels',
				'Read team handbook', 'Meet your buddy'
			]),
			link('Notion — Team Wiki Templates', 'https://www.notion.so/templates/category/engineering-wiki', 'Engineering wiki and documentation templates'),
			link('1Password — Team Credentials', 'https://1password.com/teams', 'Secure credential sharing for teams'),
			list('First Week Goals', [
				'Complete security training', 'Ship first small PR',
				'Attend team standup', 'Review architecture docs',
				'Schedule 1:1 with manager'
			]),
			note('Key Contacts', 'Manager: ___. Buddy: ___. HR: ___. IT Support: ___. Design lead: ___.')
		]
	},

	// ═══════════════════════════════════════════════════════════════════════
	// CREATIVE
	// ═══════════════════════════════════════════════════════════════════════
	{
		name: 'Design Inspiration Board',
		description: 'Collect design inspiration from the best creative resources on the web.',
		category: 'creative',
		sections: [
			link('Dribbble — Design Inspiration', 'https://dribbble.com/', 'Discover top designers and creative work'),
			link('Behance — Creative Portfolios', 'https://www.behance.net/', 'Explore creative portfolios and projects'),
			link('Coolors — Color Palette Generator', 'https://coolors.co/', 'Generate beautiful color schemes instantly'),
			link('Google Fonts', 'https://fonts.google.com/', 'Browse and pair free web fonts'),
			note('Design Principles', 'Less is more. Consistency builds trust. Whitespace is your friend. Typography sets the tone. Test with real content.')
		]
	},
	{
		name: 'Content Creator Toolkit',
		description: 'Essential tools and resources for content creators, writers, and social media.',
		category: 'creative',
		sections: [
			link('Canva — Design Tool', 'https://www.canva.com/', 'Create graphics, presentations, and social media posts'),
			link('Unsplash — Free Photos', 'https://unsplash.com/', 'Beautiful, free stock photography'),
			link('Hemingway Editor', 'https://hemingwayapp.com/', 'Make your writing bold and clear'),
			list('Content Calendar', [
				'Monday — Blog post', 'Tuesday — Newsletter draft',
				'Wednesday — Social media batch', 'Thursday — Video recording',
				'Friday — Analytics review'
			]),
			product('Blue Yeti USB Microphone', 'https://www.amazon.com/dp/B00N1YPXW2', '$99.99')
		]
	},

	// ═══════════════════════════════════════════════════════════════════════
	// WISHLIST
	// ═══════════════════════════════════════════════════════════════════════
	{
		name: 'Tech Gadgets Wishlist',
		description: 'Track the latest tech gadgets and accessories you want.',
		category: 'wishlist',
		sections: [
			product('Apple AirPods Pro 2', 'https://www.amazon.com/dp/B0D1XD1ZV3', '$189.99'),
			product('Kindle Paperwhite', 'https://www.amazon.com/dp/B0CFPJYX2T', '$149.99'),
			link('Wirecutter — Best Electronics', 'https://www.nytimes.com/wirecutter/electronics/', 'Expert-tested electronics recommendations'),
			link('RTINGS — Product Reviews', 'https://www.rtings.com/', 'In-depth product reviews with measurements'),
			note('Budget & Priority', 'Monthly gadget budget: $___. Must-haves this quarter: ___. Wait for sales: Black Friday, Prime Day, back to school.')
		]
	},
	{
		name: 'Gift Ideas Board',
		description: 'Collect gift ideas for family and friends throughout the year.',
		category: 'wishlist',
		sections: [
			list('Upcoming Birthdays', [
				'Mom — March', 'Dad — June', 'Partner — August', 'Best friend — November'
			]),
			link('Uncommon Goods — Unique Gifts', 'https://www.uncommongoods.com/', 'Creative and unique gift ideas'),
			product('Ember Temperature Control Mug', 'https://www.amazon.com/dp/B09LQXJPMG', '$99.95'),
			link('Wirecutter — Best Gifts', 'https://www.nytimes.com/wirecutter/gifts/', 'Thoughtful gift picks for every occasion'),
			note('Gift Notes', 'Keep track of what people mention wanting throughout the year. The best gifts are the ones people forgot they mentioned!')
		]
	},

	// ═══════════════════════════════════════════════════════════════════════
	// RENOVATION
	// ═══════════════════════════════════════════════════════════════════════
	{
		name: 'Kitchen Renovation Guide',
		description: 'Plan your dream kitchen renovation with budget tracking, inspiration, and supply lists.',
		category: 'renovation',
		sections: [
			link('Houzz — Kitchen Ideas', 'https://www.houzz.com/photos/kitchen-ideas-phbr0-bp~t_709', 'Browse thousands of kitchen design photos'),
			list('Budget Breakdown', [
				'Cabinets — $_____', 'Countertops — $_____', 'Appliances — $_____',
				'Flooring — $_____', 'Plumbing — $_____', 'Electrical — $_____', 'Labor — $_____'
			]),
			link('IKEA Kitchen Planner', 'https://www.ikea.com/us/en/planners/kitchen-planner/', 'Design your kitchen layout in 3D'),
			product('Stanley FatMax Tape Measure', 'https://www.amazon.com/dp/B00002PV5T', '$19.99'),
			list('Timeline', [
				'Get contractor quotes (Week 1-2)', 'Finalize design (Week 3-4)',
				'Order materials (Week 5-6)', 'Demo begins (Week 7)',
				'Installation (Week 8-10)', 'Final touches (Week 11-12)'
			])
		]
	},
	{
		name: 'Bathroom Refresh',
		description: 'Everything you need for a bathroom renovation, from fixtures to finishes.',
		category: 'renovation',
		sections: [
			link('Wayfair — Bathroom Vanities', 'https://www.wayfair.com/home-improvement/sb0/bathroom-vanities-c1805440.html', 'Shop bathroom vanities in every style'),
			link('Home Depot — Tile Guide', 'https://www.homedepot.com/b/Flooring-Tile/N-5yc1vZar2y', 'Browse tile options and get installation tips'),
			list('Fixture Decisions', [
				'Vanity style & size', 'Faucet finish (chrome/brushed nickel/matte black)',
				'Tile pattern & grout color', 'Showerhead type',
				'Mirror shape', 'Lighting fixtures'
			]),
			product('Delta Faucet Brushed Nickel', 'https://www.amazon.com/dp/B005GKDMXG', '$72.48'),
			note('Pro Tips', 'Measure twice, order once. Always budget 15-20% extra for surprises. Waterproofing is non-negotiable. Get at least 3 contractor quotes.')
		]
	}
];

// ─── Seed Logic ──────────────────────────────────────────────────────────────

async function seed() {
	console.log(`Seeding ${TEMPLATES.length} curated templates...\n`);
	let created = 0;
	let skipped = 0;

	for (const t of TEMPLATES) {
		// Idempotency check
		const existing = await db
			.collection('templates')
			.where('name', '==', t.name)
			.where('category', '==', t.category)
			.where('creatorId', '==', SYSTEM_UID)
			.limit(1)
			.get();

		if (!existing.empty) {
			console.log(`  SKIP (exists): ${t.name} [${t.category}]`);
			skipped++;
			continue;
		}

		await db.collection('templates').add({
			name: t.name,
			description: t.description,
			category: t.category,
			creatorId: SYSTEM_UID,
			creatorName: SYSTEM_NAME,
			sections: t.sections,
			sourceBoardId: null,
			cloneCount: 0,
			isCurated: true,
			createdAt: FieldValue.serverTimestamp()
		});

		console.log(`  CREATED: ${t.name} [${t.category}]`);
		created++;
	}

	console.log(`\nDone. Created: ${created}, Skipped: ${skipped}`);
}

seed().catch((err) => {
	console.error('Seed failed:', err);
	process.exit(1);
});
