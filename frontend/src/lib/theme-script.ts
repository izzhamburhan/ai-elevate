export const THEME_STORAGE_KEY = "elevate-theme";

/**
 * Runs before first paint (inlined in <head> by the root layout) so the page never flashes the
 * wrong theme: a saved choice wins, otherwise follow the OS preference.
 */
export const themeInitScript = `(function(){try{var t=localStorage.getItem("${THEME_STORAGE_KEY}");if(t!=="light"&&t!=="dark"){t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}document.documentElement.classList.toggle("dark",t==="dark");document.documentElement.style.colorScheme=t}catch(e){}})()`;
