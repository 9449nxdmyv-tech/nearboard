/**
 * @file firebase/index.ts
 * @description Barrel export for Firebase app and all service modules.
 *              Components import from here — never from individual service files.
 */

export { app, db, auth, storage } from './app';
export {
	signInWithGoogle,
	signInWithApple,
	sendEmailLink,
	completeEmailLinkSignIn,
	signOut,
	getUserDoc,
	updateLastSeen,
	setBirthDate,
	calculateAge,
	getAgeGroup,
	updateDisplayName,
	updatePhotoURL,
	updateUserFields,
	markOnboardingComplete,
	deleteAccount
} from './userService';
export type { CreateBoardOptions } from './boardService';
export {
	createBoard,
	subscribeToUserBoards,
	subscribeToBoard,
	subscribeToBoardMembers,
	getBoard,
	updateLivingSummary,
	updateBoard,
	requestSummaryRegeneration,
	deleteBoard,
	addContent,
	subscribeToBoardContent,
	subscribeToBoardPreview,
	toggleListItem,
	updateContent,
	deleteContent,
	addComment,
	subscribeToComments,
	deleteComment,
	toggleAcknowledgment,
	followBoard,
	unfollowBoard,
	subscribeToLatestBriefing,
	voteOnPoll,
	subscribeToVotes,
	lockTimeCapsule,
	unlockTimeCapsule,
	publishTemplate,
	listTemplates,
	cloneTemplate,
	generateInviteLink,
	generateShareLink,
	joinBoard,
	inviteContacts,
	getPendingInvites,
	removeMember,
	getBoardMembers,
	updateMemberNotificationMode,
	updateMemberDigestMuted,
	markBoardRead,
	syncMemberProfile,
	getLastReadAt,
	getAllReadTimestamps,
	loadMoreContent,
	subscribeToBoardContentPaginated,
	CONTENT_PAGE_SIZE,
	getRecentVideos
} from './boardService';
export {
	requestToJoin,
	getPendingJoinRequests,
	approveJoinRequest,
	rejectJoinRequest,
	getUserJoinRequestStatus,
	getPublicBoardsForUser,
	getAllBoardsForUser,
	getPublicUserProfile,
	getPublicUserProfiles
} from './joinRequestService';
export type { PublicUserProfile } from './joinRequestService';
export { registerFCMToken, onForegroundMessage } from './notificationService';
export { uploadBoardCover, uploadAvatar, uploadVoiceNote, uploadPhoto, uploadPhotos, uploadVideo } from './storageService';
export { registerProductForTracking, refreshProductPrice, getPriceHistory, parsePrice } from './pricingService';
export { setModerationStatus, getQuarantinedContent, isContentVisible } from './moderationService';
export { parseAndClassify, importApprovedCards } from './whatsAppImportService';
