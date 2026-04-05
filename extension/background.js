/**
 * @file background.js
 * @description Background service worker for right-click saving.
 */

chrome.runtime.onInstalled.addListener(() => {
	chrome.contextMenus.create({
		id: 'save-to-nearboard',
		title: 'Save to Nearboard',
		contexts: ['image', 'link', 'page', 'selection']
	});
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
	if (info.menuItemId === 'save-to-nearboard') {
		const data = {
			url: info.linkUrl || info.srcUrl || info.pageUrl,
			imageUrl: info.srcUrl || null,
			title: tab.title,
			selectionText: info.selectionText || null
		};

		chrome.storage.local.set({ pendingSave: data }, () => {
			// Visual feedback that something happened
			chrome.action.setBadgeText({ text: '!' });
			chrome.action.setBadgeBackgroundColor({ color: '#6c63ff' });
		});
	}
});
