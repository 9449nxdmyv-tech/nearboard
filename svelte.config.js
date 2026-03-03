import adapter from '@sveltejs/adapter-auto';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  kit: {
    adapter: adapter(),
    serviceWorker: {
      register: false // We register manually for PWA control
    }
  }
};

export default config;
