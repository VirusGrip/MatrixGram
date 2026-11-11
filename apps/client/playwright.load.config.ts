import { defineConfig } from '@playwright/test';
import base from './playwright.config';
export default defineConfig({...base, testIgnore: [], testMatch: '**/load.spec.ts', workers: 1, timeout: 120_000, reporter: [['list']]});
