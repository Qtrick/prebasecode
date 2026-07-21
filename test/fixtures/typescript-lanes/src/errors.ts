import { greet } from './hello.js';

// Intentional type error for manual diagnostic verification.
export const broken: number = greet(42);
