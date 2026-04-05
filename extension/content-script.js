/**
 * @file content-script.js
 * @description Extracts page metadata from the active tab DOM.
 */

(() => {
	function getMeta(selectors) {
		for (const sel of selectors) {
			const el = document.querySelector(sel);
			if (el) return el.getAttribute('content') || el.getAttribute('href');
		}
		return null;
	}

	function extractJsonLd() {
		const scripts = document.querySelectorAll('script[type="application/ld+json"]');
		for (const script of scripts) {
			try {
				const data = JSON.parse(script.textContent);
				const items = Array.isArray(data) ? data : [data];
				for (const item of items) {
					if (item['@type'] === 'Product' || item['@type'] === 'http://schema.org/Product') {
						let price = null;
						if (item.offers) {
							const offers = Array.isArray(item.offers) ? item.offers : [item.offers];
							const offer = offers[0];
							if (offer.price) {
								const currency = offer.priceCurrency || '$';
								const symbol = currency === 'USD' ? '$' : (currency === 'EUR' ? '€' : currency);
								price = `${symbol}${offer.price}`;
							}
						}
						return {
							title: item.name,
							image: Array.isArray(item.image) ? item.image[0] : (item.image?.url || item.image),
							price: price
						};
					}
				}
			} catch (e) {
				// skip
			}
		}
		return null;
	}

	function extractPageMetadata() {
		const jsonLd = extractJsonLd();
		const url = window.location.href;
		
		const price =
			jsonLd?.price ||
			getMeta(['meta[property="product:price:amount"]', 'meta[property="og:price:amount"]', 'meta[name="twitter:label1"][content="Price"] + meta[name="twitter:data1"]']);

		const ogType = getMeta(['meta[property="og:type"]']);
		let type = 'link';
		if (price) type = 'product';
		else if (ogType === 'video' || ogType === 'video.other' || url.includes('youtube.com/watch') || url.includes('youtu.be/')) type = 'video';
		else if (ogType === 'article') type = 'article';

		// Better image detection: prioritize OG, then Twitter, then largest images if none found
		let image = jsonLd?.image ||
			getMeta(['meta[property="og:image"]', 'meta[name="twitter:image"]', 'meta[name="twitter:image:src"]']);
		
		if (!image) {
			// Heuristic: Find first large-ish image in the article or main body
			const imgElements = Array.from(document.querySelectorAll('article img, main img, #content img'));
			const bestImg = imgElements.find(img => img.width > 200 && img.height > 200);
			if (bestImg) image = bestImg.src;
		}

		// YouTube specific ID extraction
		let youtubeId = null;
		if (type === 'video') {
			const ytMatch = url.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/);
			if (ytMatch) youtubeId = ytMatch[1];
		}

		return {
			title:
				jsonLd?.title ||
				getMeta(['meta[property="og:title"]', 'meta[name="twitter:title"]']) ||
				document.title ||
				'',
			image: image || null,
			description:
				getMeta(['meta[property="og:description"]', 'meta[name="twitter:description"]', 'meta[name="description"]']),
			url: url,
			price: price || null,
			type,
			youtubeId
		};
	}

	chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
		if (request.type === 'GET_PAGE_METADATA') {
			try {
				const metadata = extractPageMetadata();
				sendResponse(metadata);
			} catch (e) {
				console.error('Nearboard: Failed to extract metadata:', e);
				sendResponse(null);
			}
		}
		return true; // Keep the message channel open for the async response
	});
})();
