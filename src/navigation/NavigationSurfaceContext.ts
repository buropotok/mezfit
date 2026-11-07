import { createContext, useContext } from 'react';
import type { NavigationContext } from '../NavigationShell';

/** Read-only source snapshot for overlays; NavigationShell still owns history and Back. */
export const NavigationSurfaceContext = createContext<NavigationContext | null>(null);
export const useNavigationSurfaceContext = () => useContext(NavigationSurfaceContext);
