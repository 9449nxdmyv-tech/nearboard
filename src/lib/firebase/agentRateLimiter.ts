/**
 * @file agentRateLimiter.ts
 * @description Rate limiting for AI agents/bots (Lever 7 — Agent guardrails).
 *              Tracks agent activity and enforces limits to prevent bulk adds
 *              without human oversight.
 * 
 * Rules:
 * - Known agents: 10 cards per minute, 50 cards per hour
 * - Unknown sources: 5 cards per minute, 20 cards per hour
 * - Bulk adds (>10 cards in 1 minute) require human confirmation
 */

import { db } from './app';
import { 
	doc, 
	getDoc, 
	setDoc, 
	updateDoc, 
	Timestamp,
	collection,
	query,
	where,
	orderBy,
	limit,
	getDocs
} from 'firebase/firestore';

interface AgentActivity {
	agentId: string;
	boardId: string;
	cardCount: number;
	lastActivityAt: Timestamp;
	hourlyCount: number;
	hourlyResetAt: Timestamp;
}

const AGENT_LIMITS = {
	perMinute: 10,
	perHour: 50,
	bulkThreshold: 10  // Cards in 1 minute that trigger confirmation
};

const UNKNOWN_AGENT_LIMITS = {
	perMinute: 5,
	perHour: 20,
	bulkThreshold: 5
};

/**
 * Checks if an agent can add a card without exceeding rate limits.
 * Returns { allowed: boolean, reason?: string, requiresConfirmation?: boolean }
 */
export async function checkAgentRateLimit(
	agentId: string,
	boardId: string
): Promise<{ 
	allowed: boolean; 
	reason?: string;
	requiresConfirmation?: boolean;
	remainingPerMinute?: number;
	remainingPerHour?: number;
}> {
	const now = Timestamp.now();
	const oneMinuteAgo = new Date(Date.now() - 60 * 1000);
	const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

	const limits = isKnownAgent(agentId) ? AGENT_LIMITS : UNKNOWN_AGENT_LIMITS;

	// Get agent activity for this board
	const activityRef = doc(db(), 'agentActivity', `${agentId}_${boardId}`);
	const activitySnap = await getDoc(activityRef);

	if (!activitySnap.exists()) {
		// First activity - allow
		return { 
			allowed: true, 
			remainingPerMinute: limits.perMinute,
			remainingPerHour: limits.perHour
		};
	}

	const activity = activitySnap.data() as AgentActivity;

	// Reset hourly count if hour has passed
	if (activity.hourlyResetAt.toMillis() < now.toMillis()) {
		activity.hourlyCount = 0;
		activity.hourlyResetAt = Timestamp.fromDate(
			new Date(Date.now() + 60 * 60 * 1000)
		);
	}

	// Check per-minute limit
	if (activity.cardCount >= limits.perMinute) {
		// Check if we need to reset the minute window
		const lastActivity = activity.lastActivityAt.toMillis();
		if (now.toMillis() - lastActivity < 60 * 1000) {
			return { 
				allowed: false, 
				reason: 'Rate limit exceeded. Please wait before adding more cards.'
			};
		}
		// Reset minute count
		activity.cardCount = 0;
	}

	// Check per-hour limit
	if (activity.hourlyCount >= limits.perHour) {
		return { 
			allowed: false, 
			reason: 'Hourly limit exceeded. Please wait before adding more cards.'
		};
	}

	// Check if bulk confirmation is needed
	const requiresConfirmation = activity.cardCount >= limits.bulkThreshold;

	return { 
		allowed: true,
		requiresConfirmation,
		remainingPerMinute: limits.perMinute - activity.cardCount - 1,
		remainingPerHour: limits.perHour - activity.hourlyCount - 1
	};
}

/**
 * Records agent activity after successfully adding a card.
 */
export async function recordAgentActivity(
	agentId: string,
	boardId: string
): Promise<void> {
	const now = Timestamp.now();
	const activityRef = doc(db(), 'agentActivity', `${agentId}_${boardId}`);
	const activitySnap = await getDoc(activityRef);

	if (!activitySnap.exists()) {
		// Create new activity record
		const newActivity: AgentActivity = {
			agentId,
			boardId,
			cardCount: 1,
			lastActivityAt: now,
			hourlyCount: 1,
			hourlyResetAt: Timestamp.fromDate(new Date(Date.now() + 60 * 60 * 1000))
		};
		await setDoc(activityRef, newActivity);
	} else {
		// Update existing activity
		const activity = activitySnap.data() as AgentActivity;
		
		// Reset hourly count if hour has passed
		if (activity.hourlyResetAt.toMillis() < now.toMillis()) {
			activity.hourlyCount = 0;
			activity.hourlyResetAt = Timestamp.fromDate(
				new Date(Date.now() + 60 * 60 * 1000)
			);
		}

		// Reset minute count if minute has passed
		if (now.toMillis() - activity.lastActivityAt.toMillis() >= 60 * 1000) {
			activity.cardCount = 0;
		}

		activity.cardCount++;
		activity.hourlyCount++;
		activity.lastActivityAt = now;

		await updateDoc(activityRef, {
			cardCount: activity.cardCount,
			hourlyCount: activity.hourlyCount,
			lastActivityAt: activity.lastActivityAt,
			hourlyResetAt: activity.hourlyResetAt
		});
	}
}

/**
 * Checks if an agent ID is a known, trusted agent.
 * Known agents have higher rate limits.
 */
function isKnownAgent(agentId: string): boolean {
	// List of known agent IDs (e.g., official Nearboard AI agents)
	const KNOWN_AGENTS = [
		'nearboard-ai-assistant',
		'nearboard-auto-categorizer',
		'nearboard-voice-transcriber'
	];
	return KNOWN_AGENTS.includes(agentId);
}

/**
 * Middleware function to wrap addContent calls for agent protection.
 * Throws error if rate limit exceeded or confirmation required.
 */
export async function withAgentProtection<T>(
	agentId: string | undefined,
	boardId: string,
	fn: () => Promise<T>
): Promise<T> {
	// If no agent ID, proceed normally (human user)
	if (!agentId) {
		return fn();
	}

	// Check rate limits
	const result = await checkAgentRateLimit(agentId, boardId);

	if (!result.allowed) {
		throw new Error(`AGENT_RATE_LIMITED: ${result.reason}`);
	}

	if (result.requiresConfirmation) {
		throw new Error('AGENT_CONFIRMATION_REQUIRED: Bulk add detected. Human confirmation required.');
	}

	// Execute the function
	const result_ = await fn();

	// Record activity after success
	await recordAgentActivity(agentId, boardId);

	return result_;
}
