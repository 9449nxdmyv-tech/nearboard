/**
 * @file admin.ts
 * @description Shared Firebase Admin initialization. Import this from any Cloud
 *              Function file instead of repeating the getApps()/initializeApp() guard.
 */

import { initializeApp, getApps } from 'firebase-admin/app';

if (getApps().length === 0) initializeApp();
