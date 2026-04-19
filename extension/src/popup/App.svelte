<!--
  @file App.svelte (Extension Popup)
  @description Max 400px popup: auto-extracted content preview, board selector,
               optional note, voice recording, and "Save to Nearboard" button.
  @todos
    - MED SECURITY: Add chrome-extension:// origin to Firebase authorized domains
-->
<script lang="ts">
	import Icon from '@iconify/svelte';
	import { onMount } from 'svelte';
	import {
		onAuthStateChanged,
		GoogleAuthProvider,
		signInWithPopup,
		signInWithCredential,
		type User,
		initializeAuth,
		indexedDBLocalPersistence,
		browserPopupRedirectResolver
	} from 'firebase/auth';
	import { collection, query, where, getDocs, addDoc, serverTimestamp } from 'firebase/firestore';
	import { initializeApp, getApps } from 'firebase/app';
	import type { PageMetadata } from '$lib/types/api';
	import { refineDetection as refineContentType } from '$lib/utils/contentDetection';
	import { extractDomain, faviconUrl } from '$lib/utils/urlUtils';

	// Firebase init (reads same VITE_ env vars baked at build time)
	const firebaseConfig = {
		apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
		authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
		projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
		storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
		messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
		appId: import.meta.env.VITE_FIREBASE_APP_ID
	};
	const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
	
	// Use initializeAuth for extensions to ensure persistence and redirect resolver work correctly
	const auth = initializeAuth(app, {
		persistence: indexedDBLocalPersistence,
		popupRedirectResolver: browserPopupRedirectResolver
	});

	let user = $state<User | null>(null);
	let metadata = $state<PageMetadata | null>(null);
	let boards = $state<{ id: string; name: string }[]>([]);
	let selectedBoardId = $state('');
	let noteText = $state('');
	let loading = $state(true);
	let saving = $state(false);
	let saved = $state(false);
	let signingIn = $state(false);
	let error = $state<string | null>(null);

	// Voice recording state
	const MAX_VOICE_DURATION_MS = 30_000;
	let recording = $state(false);
	let recordingElapsed = $state(0);
	let audioBlob = $state<Blob | null>(null);
	let mediaRecorder: MediaRecorder | null = null;
	let recordingInterval: ReturnType<typeof setInterval> | null = null;
	let recordingTimeout: ReturnType<typeof setTimeout> | null = null;

	function startRecording() {
		error = null;
		audioBlob = null;
		navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
			const chunks: Blob[] = [];
			mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
			mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
			mediaRecorder.onstop = () => {
				stream.getTracks().forEach((t) => t.stop());
				audioBlob = new Blob(chunks, { type: 'audio/webm' });
				recording = false;
				recordingElapsed = 0;
				if (recordingInterval) { clearInterval(recordingInterval); recordingInterval = null; }
				if (recordingTimeout) { clearTimeout(recordingTimeout); recordingTimeout = null; }
			};
			mediaRecorder.start();
			recording = true;
			recordingElapsed = 0;
			recordingInterval = setInterval(() => { recordingElapsed += 1000; }, 1000);
			recordingTimeout = setTimeout(() => stopRecording(), MAX_VOICE_DURATION_MS);
		}).catch(() => {
			error = 'Microphone access denied.';
		});
	}

	function stopRecording() {
		if (mediaRecorder && mediaRecorder.state === 'recording') {
			mediaRecorder.stop();
		}
	}

	function discardRecording() {
		audioBlob = null;
	}

	async function saveVoiceNote() {
		if (!user || !selectedBoardId || !audioBlob) return;
		saving = true;
		error = null;
		try {
			const { getFirestore } = await import('firebase/firestore');
			const { getStorage, ref, uploadBytes, getDownloadURL } = await import('firebase/storage');
			const db = getFirestore(app);
			const storage = getStorage(app);

			const fileName = `voice_${Date.now()}.webm`;
			const storageRef = ref(storage, `boards/${selectedBoardId}/voice/${fileName}`);
			await uploadBytes(storageRef, audioBlob, { contentType: 'audio/webm' });
			const audioUrl = await getDownloadURL(storageRef);

			await addDoc(collection(db, 'boards', selectedBoardId, 'content'), {
				boardId: selectedBoardId,
				authorId: user.uid,
				authorName: user.displayName ?? user.email ?? '',
				authorPhotoURL: user.photoURL,
				createdAt: serverTimestamp(),
				moderationStatus: 'approved',
				type: 'voice',
				audioUrl,
				durationMs: recordingElapsed || MAX_VOICE_DURATION_MS
			});

			audioBlob = null;
			saved = true;
		} catch (e: any) {
			console.error('Voice save error:', e);
			error = `Failed to save voice note: ${e.message || 'Unknown error'}`;
		} finally {
			saving = false;
		}
	}

	let loadingTimeout: ReturnType<typeof setTimeout> | null = null;

	onMount(() => {
		console.log('Popup mounted. Checking auth state...');
		// Set a timeout for loading state to prevent infinite spinner
		loadingTimeout = setTimeout(() => {
			if (loading) {
				loading = false;
				if (!user) {
					console.error('Auth timeout: onAuthStateChanged never fired.');
					error = 'Connection timed out. Please ensure you are logged into Nearboard and have a stable connection.';
				}
			}
		}, 8000);

		// 1. Check for Pinterest-style context menu save
		chrome.storage.local.get(['pendingSave'], (result) => {
			if (result.pendingSave) {
				const { url, imageUrl, title, selectionText } = result.pendingSave;
				metadata = {
					url,
					image: imageUrl,
					title: title || 'Saved item',
					description: selectionText || null,
					price: null,
					type: selectionText ? 'article' : 'link'
				};
				if (selectionText) {
					noteText = selectionText;
				}
				// Clear badge and data
				chrome.storage.local.remove(['pendingSave']);
				chrome.action.setBadgeText({ text: '' });
			} else {
				// 2. Normal extraction from active tab
				chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
					if (tab?.id && tab.url?.startsWith('http')) {
						chrome.tabs.sendMessage(tab.id, { type: 'GET_PAGE_METADATA' }, (response) => {
							if (chrome.runtime.lastError) {
								console.warn('Content script not found, using tab metadata fallback.');
								metadata = {
									title: tab.title || '',
									url: tab.url || '',
									image: null,
									description: null,
									price: null,
									type: 'link'
								};
							} else if (response) {
								metadata = response as PageMetadata;
							}
						});
					} else if (tab?.url) {
						error = 'Cannot save this type of page.';
						loading = false;
					} else {
						loading = false;
					}
				});
			}
		});

		// Auth listener
		const unsubscribe = onAuthStateChanged(auth, async (u) => {
			console.log('Auth state changed:', u ? `User: ${u.uid}` : 'User is null');
			clearTimeout(loadingTimeout);
			user = u;
			if (u) {
				try {
					const { getFirestore } = await import('firebase/firestore');
					const db = getFirestore(app);
					const q = query(
						collection(db, 'boards'),
						where('memberIds', 'array-contains', u.uid)
					);
					const snap = await getDocs(q);
					boards = snap.docs.map((d) => ({ id: d.id, name: (d.data() as { name: string }).name }));
					console.log(`Loaded ${boards.length} boards.`);
					if (boards.length > 0) selectedBoardId = boards[0].id;
				} catch (e: any) {
					console.error('Failed to load boards:', e);
					error = `Failed to load boards: ${e.message || 'Unknown error'}`;
				}
			}
			loading = false;
		});

		return () => {
			unsubscribe();
			if (loadingTimeout) { clearTimeout(loadingTimeout); loadingTimeout = null; }
			if (recordingInterval) { clearInterval(recordingInterval); recordingInterval = null; }
			if (recordingTimeout) { clearTimeout(recordingTimeout); recordingTimeout = null; }
			// Stop recording + release microphone if popup closes mid-capture
			if (mediaRecorder && mediaRecorder.state === 'recording') {
				try { mediaRecorder.stop(); } catch { /* ignore */ }
			}
		};
	});

	async function handleSignIn() {
		try {
			error = null;
			signingIn = true;
			
			// Use chrome.identity for native sign-in in Manifest V3 extensions.
			// This avoids loading remote scripts (GAPI) which violates CSP.
			if (typeof chrome !== 'undefined' && chrome.identity) {
				console.log('Nearboard: Starting chrome.identity.getAuthToken...');
				chrome.identity.getAuthToken({ interactive: true }, async (token) => {
					if (chrome.runtime.lastError) {
						const msg = chrome.runtime.lastError.message;
						console.error('Nearboard: chrome.identity error:', msg);
						error = `Sign-in failed: ${msg}. If this is 'OAuth2 client not found', ensure you have set the Client ID in manifest.json and the extension is published or added to your developer console.`;
						signingIn = false;
						return;
					}
					
					if (!token) {
						error = 'Sign-in failed: No token received.';
						signingIn = false;
						return;
					}

					try {
						console.log('Nearboard: Exchanging token for Firebase credential...');
						const credential = GoogleAuthProvider.credential(null, token);
						await signInWithCredential(auth, credential);
						console.log('Nearboard: Firebase sign-in successful.');
					} catch (e: any) {
						console.error('Nearboard: Firebase credential sign-in error:', e);
						error = `Firebase sign-in failed: ${e.message}`;
					} finally {
						signingIn = false;
					}
				});
			} else {
				// Fallback for local development/non-extension environments
				await signInWithPopup(auth, new GoogleAuthProvider());
				signingIn = false;
			}
		} catch (e: any) {
			console.error('Nearboard: Sign-in error:', e);
			signingIn = false;
			if (e.code === 'auth/operation-not-supported-in-this-environment') {
				error = 'Sign-in is not supported in this environment. Chrome extensions require chrome.identity API and a configured OAuth2 Client ID.';
			} else {
				error = `Sign-in failed: ${e.message || 'Unknown error'}`;
			}
		}
	}

	async function handleSave() {
		if (!user || !selectedBoardId || !metadata) return;
		saving = true;
		error = null;

		try {
			const { getFirestore } = await import('firebase/firestore');
			const db = getFirestore(app);
			const domain = extractDomain(metadata.url);
			
			// If we have noteText but it's specifically from a selection clip
			const isNote = !!noteText && metadata.description === noteText;
			const contentType = isNote ? 'note' : refineContentType(metadata);

			const base = {
				boardId: selectedBoardId,
				authorId: user.uid,
				authorName: user.displayName ?? user.email ?? '',
				authorPhotoURL: user.photoURL,
				createdAt: serverTimestamp(),
				moderationStatus: 'approved' // Default for extension saves
			};

			if (contentType === 'product' && metadata.price) {
				const contentId = await addDoc(collection(db, 'boards', selectedBoardId, 'content'), {
					...base,
					type: 'product',
					url: metadata.url,
					title: metadata.title,
					image: metadata.image,
					price: metadata.price,
					domain,
					originalPrice: metadata.price,
					lastCheckedPrice: null,
					lastCheckedAt: null,
					priceDrop: false
				}).then(d => d.id);

				// Register for price tracking
				const { setDoc, doc } = await import('firebase/firestore');
				const docId = encodeURIComponent(metadata.url).slice(0, 1500);
				await setDoc(doc(db, 'prices', docId), {
					productUrl: metadata.url,
					boardId: selectedBoardId,
					contentId,
					entries: [{ price: metadata.price, checkedAt: new Date() }],
					priceDrop: false,
					lastCheckedAt: serverTimestamp()
				});
			} else if (contentType === 'video') {
				await addDoc(collection(db, 'boards', selectedBoardId, 'content'), {
					...base,
					type: 'video',
					url: metadata.url,
					title: metadata.title,
					videoUrl: metadata.url,
					thumbnailUrl: metadata.image || (metadata.youtubeId ? `https://img.youtube.com/vi/${metadata.youtubeId}/mqdefault.jpg` : null),
					caption: noteText.trim() || null
				});
			} else if (contentType === 'note') {
				await addDoc(collection(db, 'boards', selectedBoardId, 'content'), {
					...base,
					type: 'note',
					text: noteText.trim()
				});
			} else {
				await addDoc(collection(db, 'boards', selectedBoardId, 'content'), {
					...base,
					type: 'link',
					url: metadata.url,
					title: metadata.title,
					description: metadata.description,
					image: metadata.image,
					domain,
					favicon: faviconUrl(domain),
					...(noteText.trim() ? { note: noteText.trim() } : {})
				});
			}

			saved = true;
		} catch (e: any) {
			console.error('Save error:', e);
			error = `Failed to save: ${e.message || 'Unknown error'}`;
		} finally {
			saving = false;
		}
	}
</script>

<style>
	.check-circle {
		stroke-dasharray: 166;
		stroke-dashoffset: 166;
		animation: check-stroke 0.6s cubic-bezier(0.65, 0, 0.45, 1) forwards;
	}
	.check-path {
		stroke-dasharray: 48;
		stroke-dashoffset: 48;
		animation: check-stroke 0.3s cubic-bezier(0.65, 0, 0.45, 1) 0.4s forwards;
	}
	.save-success-check {
		animation: check-scale 0.3s ease-in-out 0.7s both;
	}
	.save-fade-in {
		opacity: 0;
		animation: check-fade 0.3s ease-in 0.8s forwards;
	}
	@keyframes check-stroke {
		to { stroke-dashoffset: 0; }
	}
	@keyframes check-scale {
		0%, 100% { transform: scale(1); }
		50% { transform: scale(1.15); }
	}
	@keyframes check-fade {
		to { opacity: 1; }
	}
</style>

<div class="p-4">
	{#if loading}
		<p class="text-muted text-sm text-center py-8">Loading...</p>
	{:else if !user}
		<!-- Sign in -->
		<div class="text-center py-6">
			<h1 class="text-lg font-semibold text-primary mb-1">Nearboard</h1>
			<p class="text-muted text-xs mb-4">Sign in to save to your boards.</p>
			
			{#if error}
				<div class="bg-red-50 border border-red-100 rounded-input p-3 mb-4 text-left">
					<p class="text-red-600 text-[10px] font-bold uppercase tracking-wider mb-1">Error Details</p>
					<p class="text-red-500 text-[11px] leading-relaxed">{error}</p>
				</div>
			{/if}

			<button
				onclick={handleSignIn}
				disabled={signingIn}
				class="w-full py-2.5 bg-card border border-border rounded-input text-sm
					font-medium shadow-card flex items-center justify-center gap-2
					disabled:opacity-50 active:scale-[0.98] transition-transform"
			>
				{#if signingIn}
					<Icon icon="ph:spinner-gap-bold" class="animate-spin text-lg" />
					Signing in...
				{:else}
					Continue with Google
				{/if}
			</button>
		</div>
	{:else if saved}
		<!-- Success with animated checkmark -->
		<div class="text-center py-8">
			<div class="save-success-check">
				<svg class="w-12 h-12 mx-auto" viewBox="0 0 52 52">
					<circle class="check-circle" cx="26" cy="26" r="24" fill="none" stroke="var(--color-success, #34c98a)" stroke-width="2" />
					<path class="check-path" fill="none" stroke="var(--color-success, #34c98a)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" d="M14 27l8 8 16-16" />
				</svg>
			</div>
			<p class="text-success font-medium text-sm mt-2 save-fade-in">Saved to Nearboard!</p>
		</div>
	{:else}
		<!-- Preview + Save -->
		<h1 class="text-sm font-semibold text-primary mb-3">Save to Nearboard</h1>

		{#if metadata}
			<div class="border border-border rounded-card p-3 mb-3 bg-card">
				{#if metadata.image}
					<img src={metadata.image} alt="" class="w-full h-24 object-cover rounded-input mb-2" />
				{/if}
				<p class="text-sm font-medium text-primary line-clamp-2">{metadata.title}</p>
				{#if metadata.description}
					<p class="text-xs text-muted mt-1 line-clamp-1">{metadata.description}</p>
				{/if}
				<div class="flex items-center gap-1.5 mt-2">
					<img src={faviconUrl(extractDomain(metadata.url))} alt="" class="w-3.5 h-3.5 rounded" />
					<span class="text-xs text-muted">{extractDomain(metadata.url)}</span>
					{#if metadata.price}
						<span class="text-xs font-semibold text-accent ml-auto">{metadata.price}</span>
					{/if}
				</div>
			</div>
		{/if}

		<!-- Board selector -->
		{#if boards.length > 0}
			<select
				bind:value={selectedBoardId}
				class="w-full py-2 px-3 border border-border rounded-input text-sm bg-card mb-2"
			>
				{#each boards as b (b.id)}
					<option value={b.id}>{b.name}</option>
				{/each}
			</select>
		{:else}
			<p class="text-muted text-xs mb-2">No boards yet. Create one in the app first.</p>
		{/if}

		<!-- Optional note -->
		<input
			type="text"
			bind:value={noteText}
			placeholder="Add a note (optional)"
			class="w-full py-2 px-3 border border-border rounded-input text-sm bg-card
				placeholder:text-muted focus:outline-none focus:border-accent mb-2"
		/>

		<!-- Voice note recording -->
		<div class="flex items-center gap-2 mb-3">
			{#if recording}
				<button
					onclick={stopRecording}
					class="flex items-center gap-1.5 px-3 py-2 bg-red-50 border border-red-200 rounded-input text-xs text-red-600 font-medium
						active:scale-[0.98] transition-transform"
				>
					<span class="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span>
					{Math.floor(recordingElapsed / 1000)}s / 30s — Tap to stop
				</button>
			{:else if audioBlob}
				<div class="flex items-center gap-2 flex-1">
					<span class="flex items-center gap-1 text-xs text-primary">
						<Icon icon="ph:microphone-fill" class="text-sm text-accent" />
						Voice note ready
					</span>
					<button
						onclick={discardRecording}
						class="text-xs text-muted hover:text-red-500 transition-colors"
					>
						Discard
					</button>
				</div>
				<button
					onclick={saveVoiceNote}
					disabled={saving || !selectedBoardId}
					class="px-3 py-1.5 bg-accent text-white rounded-input text-xs font-medium
						disabled:opacity-50 active:scale-[0.98] transition-transform"
				>
					{saving ? 'Saving...' : 'Save voice'}
				</button>
			{:else}
				<button
					onclick={startRecording}
					disabled={!selectedBoardId}
					class="flex items-center gap-1.5 px-3 py-2 border border-border rounded-input text-xs text-muted
						hover:border-accent hover:text-accent disabled:opacity-30 transition-colors"
					aria-label="Record voice note"
				>
					<Icon icon="ph:microphone" class="text-sm" />
					Record voice note
				</button>
			{/if}
		</div>

		{#if error}
			<p class="text-red-500 text-xs mb-2">{error}</p>
		{/if}

		<button
			onclick={handleSave}
			disabled={saving || !selectedBoardId || !metadata}
			class="w-full py-2.5 bg-accent text-white rounded-input text-sm font-medium
				disabled:opacity-50 active:scale-[0.98] transition-transform"
		>
			{saving ? 'Saving...' : 'Save to Nearboard'}
		</button>
	{/if}
</div>
