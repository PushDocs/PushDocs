const router = { refresh: () => window.dispatchEvent(new Event("fixture:refresh")) };

export const useRouter = () => router;
export const usePathname = () => window.location.pathname;
