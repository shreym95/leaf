// Session store (Zustand v5). Minimal view of the signed-in user for the client.
//
// M1: populated from Supabase auth

import { create } from "zustand";

export interface SessionUser {
  id: string;
  email: string;
}

export interface SessionState {
  user: SessionUser | null;
  setUser: (user: SessionUser | null) => void;
  clear: () => void;
}

export const useSession = create<SessionState>((set) => ({
  user: null,
  setUser: (user) => set({ user }),
  clear: () => set({ user: null }),
}));
