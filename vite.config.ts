import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, loadEnv } from 'vite';
import { writeFileSync } from 'fs';

export default defineConfig(({ mode }) => {
	const env = loadEnv(mode, process.cwd(), 'VITE_');

	const firebaseConfig = {
		apiKey: env.VITE_FIREBASE_API_KEY,
		authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
		projectId: env.VITE_FIREBASE_PROJECT_ID,
		storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
		messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
		appId: env.VITE_FIREBASE_APP_ID
	};

	writeFileSync('static/firebase-config.json', JSON.stringify(firebaseConfig));
	writeFileSync(
		'static/firebase-config.js',
		`self.firebaseConfig = ${JSON.stringify(firebaseConfig)};`
	);

	return {
		plugins: [
			tailwindcss(),
			sveltekit()
		],
		css: {
			preprocessorOptions: {
				scss: {
					api: 'modern-compiler'
				}
			}
		},
		build: {
			rollupOptions: {
				output: {
					manualChunks(id: string) {
						if (id.includes('maplibre-gl')) return 'maplibre';
						if (id.includes('gsap')) return 'gsap';
						if (id.includes('konsta')) return 'konsta';
					}
				}
			}
		}
	};
});
