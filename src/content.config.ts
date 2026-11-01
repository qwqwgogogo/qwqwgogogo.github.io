import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';
import { subjects } from './data/subjects.mjs';

const blog = defineCollection({
	// Load Markdown and MDX files in the `src/content/blog/` directory.
	loader: glob({ base: './src/content/blog', pattern: '**/*.{md,mdx}' }),
	// Type-check frontmatter using a schema
	schema: ({ image }) =>
		z.object({
			title: z.string(),
			description: z.string(),
			// Transform string to Date object
			pubDate: z.coerce.date(),
			updatedDate: z.coerce.date().optional(),
			heroImage: z.optional(image()),
		}),
});

const notes = defineCollection({
	loader: glob({ base: './src/content/notes', pattern: '**/*.{md,mdx}' }),
	// 科目只认 src/data/subjects.mjs 里列的 key，写错在构建时就报错而不是悄悄漏一篇
	schema: () =>
		z.object({
			title: z.string(),
			description: z.string(),
			subject: z
				.string()
				.refine((key) => subjects.some((s) => s.key === key), {
					message: 'subject 要写 subjects.mjs 里的 key（ds / co / os / net）',
				}),
			pubDate: z.coerce.date(),
			tags: z.array(z.string()).default([]),
		}),
});

export const collections = { blog, notes };

