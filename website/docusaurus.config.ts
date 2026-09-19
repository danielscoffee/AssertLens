import { themes as prismThemes } from "prism-react-renderer";
import type { Config } from "@docusaurus/types";
import type * as Preset from "@docusaurus/preset-classic";

const config: Config = {
	title: "AssertLens",
	tagline: "Local correctness checks and advisory Jev review",
	// Local preview only. Set url and baseUrl before publishing.
	url: "http://localhost:3000",
	baseUrl: "/",
	onBrokenLinks: "throw",
	onBrokenAnchors: "throw",
	markdown: {
		hooks: {
			onBrokenMarkdownLinks: "throw",
		},
	},
	i18n: {
		defaultLocale: "en",
		locales: ["en"],
	},
	presets: [
		[
			"classic",
			{
				docs: {
					routeBasePath: "/",
					sidebarPath: "./sidebars.ts",
				},
				blog: false,
				pages: false,
			} satisfies Preset.Options,
		],
	],
	themeConfig: {
		colorMode: {
			respectPrefersColorScheme: true,
		},
		navbar: {
			title: "AssertLens",
			items: [
				{
					type: "docSidebar",
					sidebarId: "docs",
					label: "Docs",
					position: "left",
				},
				{
					href: "https://github.com/danielscoffee/AssertLens",
					label: "GitHub",
					position: "right",
				},
			],
		},
		prism: {
			theme: prismThemes.github,
			darkTheme: prismThemes.dracula,
		},
	} satisfies Preset.ThemeConfig,
};

export default config;
