import adapterStatic from '@sveltejs/adapter-static';
import adapterAuto from '@sveltejs/adapter-auto';

const useStatic = !process.env.VERCEL;

/** @type {import('@sveltejs/kit').Config} */
const config = {
  kit: {
    adapter: useStatic
      ? adapterStatic({ pages: 'build', assets: 'build', fallback: 'index.html' })
      : adapterAuto(),
    serviceWorker: {
      register: false
    }
  }
};

export default config;
