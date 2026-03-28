import { type User } from 'firebase/auth';
export declare function getFirebaseAuthErrorMessage(error?: unknown): string;
export declare function ensureAnonymousSession(): Promise<User>;
export declare function getFirebaseIdToken(forceRefresh?: boolean): Promise<string>;
export declare function subscribeToFirebaseAuth(callback: (user: User | null) => void): () => void;
