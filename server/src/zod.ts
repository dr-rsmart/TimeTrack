/**
 * Shared Zod instance extended with OpenAPI metadata.
 * -----------------------------------------------------
 * `extendZodWithOpenApi` must run BEFORE any schema is created, so every
 * module that defines Zod schemas should import `z` from here instead of
 * from 'zod' directly. This keeps runtime validation and OpenAPI generation
 * operating on the same instrumented instance.
 *
 * Re-exporting the imported binding (rather than a new const) preserves the
 * `z.infer<...>` type namespace that zod provides.
 */

import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

extendZodWithOpenApi(z);

export { z };
