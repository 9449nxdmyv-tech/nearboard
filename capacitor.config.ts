import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
	appId: 'app.nearboard',
	appName: 'Nearboard',
	webDir: 'build',
	server: {
		androidScheme: 'https'
	},
	plugins: {
		PushNotifications: {
			presentationOptions: ['badge', 'sound', 'alert']
		}
	},
	android: {
		// Intent filters for receiving shared content from other apps
		intentFilters: [
			{
				action: 'android.intent.action.SEND',
				categories: ['android.intent.category.DEFAULT'],
				data: [{ mimeType: 'text/plain' }]
			},
			{
				action: 'android.intent.action.SEND',
				categories: ['android.intent.category.DEFAULT'],
				data: [{ mimeType: 'image/*' }]
			},
			{
				action: 'android.intent.action.SEND_MULTIPLE',
				categories: ['android.intent.category.DEFAULT'],
				data: [{ mimeType: 'image/*' }]
			}
		]
	}
};

export default config;
