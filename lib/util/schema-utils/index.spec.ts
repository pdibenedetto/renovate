import { codeBlock } from 'common-tags';
import { z } from 'zod';
import {
  Json,
  Json5,
  Jsonc,
  LooseArray,
  LooseRecord,
  MultidocYaml,
  NotCircular,
  Toml,
  UtcDate,
  Yaml,
  multidocYaml,
  withDebugMessage,
  withTraceMessage,
} from '.';
import { logger } from '~test/util';

describe('util/schema-utils/index', () => {
  describe('LooseArray', () => {
    it('parses array', () => {
      const s = LooseArray(z.string());
      expect(s.parse(['foo', 'bar'])).toEqual(['foo', 'bar']);
    });

    it('drops wrong items', () => {
      const s = LooseArray(z.string());
      expect(s.parse(['foo', 123, null, undefined, []])).toEqual(['foo']);
    });

    it('runs callback for wrong elements', () => {
      let err: z.ZodError | undefined = undefined;
      const Schema = LooseArray(z.string(), {
        onError: ({ error }) => {
          err = error;
        },
      });

      const res = Schema.parse(['foo', 123, 'bar']);

      expect(res).toEqual(['foo', 'bar']);
      expect(err).toMatchObject({
        issues: [
          {
            message: 'Expected string, received number',
            code: 'invalid_type',
            expected: 'string',
            received: 'number',
            path: [1],
          },
        ],
      });
    });
  });

  describe('LooseRecord', () => {
    it('parses record', () => {
      const s = LooseRecord(z.string());
      expect(s.parse({ foo: 'bar' })).toEqual({ foo: 'bar' });
    });

    it('drops wrong items', () => {
      const s = LooseRecord(z.string());
      expect(s.parse({ foo: 'foo', bar: 123 })).toEqual({ foo: 'foo' });
    });

    it('supports key schema', () => {
      const s = LooseRecord(
        z
          .string()
          .refine((x) => x === 'bar')
          .transform((x) => x.toUpperCase()),
        z.string().transform((x) => x.toUpperCase()),
      );
      expect(s.parse({ foo: 'foo', bar: 'bar' })).toEqual({ BAR: 'BAR' });
    });

    it('reports key schema errors', () => {
      let errorData: unknown = null;
      const s = LooseRecord(
        z.string().refine((x) => x === 'bar'),
        z.string(),
        {
          onError: (x) => {
            errorData = x;
          },
        },
      );

      s.parse({ foo: 'foo', bar: 'bar' });

      expect(errorData).toMatchObject({
        error: {
          issues: [
            {
              code: 'custom',
              message: 'Invalid input',
              path: ['foo'],
            },
          ],
        },
        input: { bar: 'bar', foo: 'foo' },
      });
    });

    it('runs callback for wrong elements', () => {
      let err: z.ZodError | undefined = undefined;
      const Schema = LooseRecord(
        z.object({ foo: z.object({ bar: z.string() }) }),
        {
          onError: ({ error }) => {
            err = error;
          },
        },
      );

      const res = Schema.parse({
        aaa: { foo: { bar: 42 } },
        bbb: { foo: { baz: 'asdf' } },
        ccc: { foo: { bar: 'baz' } },
      });

      expect(res).toEqual({ ccc: { foo: { bar: 'baz' } } });
      expect(err).toMatchObject({
        issues: [
          {
            message: 'Expected string, received number',
            code: 'invalid_type',
            expected: 'string',
            received: 'number',
            path: ['aaa', 'foo', 'bar'],
          },
          {
            message: 'Required',
            code: 'invalid_type',
            expected: 'string',
            received: 'undefined',
            path: ['bbb', 'foo', 'bar'],
          },
        ],
      });
    });
  });

  describe('Json', () => {
    it('parses json', () => {
      const Schema = Json.pipe(z.object({ foo: z.literal('bar') }));

      expect(Schema.parse('{"foo": "bar"}')).toEqual({ foo: 'bar' });

      expect(Schema.safeParse(42)).toMatchObject({
        error: {
          issues: [
            {
              message: 'Expected string, received number',
              code: 'invalid_type',
              expected: 'string',
              received: 'number',
              path: [],
            },
          ],
        },
        success: false,
      });

      expect(Schema.safeParse('{"foo": "foo"}')).toMatchObject({
        error: {
          issues: [
            {
              message: 'Invalid literal value, expected "bar"',
              code: 'invalid_literal',
              expected: 'bar',
              received: 'foo',
              path: ['foo'],
            },
          ],
        },
        success: false,
      });

      expect(Schema.safeParse('["foo", "bar"]')).toMatchObject({
        error: {
          issues: [
            {
              message: 'Expected object, received array',
              code: 'invalid_type',
              expected: 'object',
              received: 'array',
              path: [],
            },
          ],
        },
        success: false,
      });

      expect(Schema.safeParse('{{{}}}')).toMatchObject({
        error: {
          issues: [
            {
              message: 'Invalid JSON',
              code: 'custom',
              path: [],
            },
          ],
        },
        success: false,
      });
    });
  });

  describe('Json5', () => {
    it('parses JSON5', () => {
      const Schema = Json5.pipe(z.object({ foo: z.literal('bar') }));

      expect(Schema.parse('{"foo": "bar"}')).toEqual({ foo: 'bar' });

      expect(Schema.safeParse(42)).toMatchObject({
        error: {
          issues: [
            {
              message: 'Expected string, received number',
              code: 'invalid_type',
              expected: 'string',
              received: 'number',
              path: [],
            },
          ],
        },
        success: false,
      });

      expect(Schema.safeParse('{"foo": "foo"}')).toMatchObject({
        error: {
          issues: [
            {
              message: 'Invalid literal value, expected "bar"',
              code: 'invalid_literal',
              expected: 'bar',
              received: 'foo',
              path: ['foo'],
            },
          ],
        },
        success: false,
      });

      expect(Schema.safeParse('["foo", "bar"]')).toMatchObject({
        error: {
          issues: [
            {
              message: 'Expected object, received array',
              code: 'invalid_type',
              expected: 'object',
              received: 'array',
              path: [],
            },
          ],
        },
        success: false,
      });

      expect(Schema.safeParse('{{{}}}')).toMatchObject({
        error: {
          issues: [
            {
              message: 'Invalid JSON5',
              code: 'custom',
              path: [],
            },
          ],
        },
        success: false,
      });
    });
  });

  describe('Jsonc', () => {
    it('parses JSONC', () => {
      const Schema = Jsonc.pipe(z.object({ foo: z.literal('bar') }));

      expect(Schema.parse('{"foo": "bar"}')).toEqual({ foo: 'bar' });

      expect(Schema.safeParse(42)).toMatchObject({
        error: {
          issues: [
            {
              message: 'Expected string, received number',
              code: 'invalid_type',
              expected: 'string',
              received: 'number',
              path: [],
            },
          ],
        },
        success: false,
      });

      expect(Schema.safeParse('{"foo": "foo"}')).toMatchObject({
        error: {
          issues: [
            {
              message: 'Invalid literal value, expected "bar"',
              code: 'invalid_literal',
              expected: 'bar',
              received: 'foo',
              path: ['foo'],
            },
          ],
        },
        success: false,
      });

      expect(Schema.safeParse('["foo", "bar"]')).toMatchObject({
        error: {
          issues: [
            {
              message: 'Expected object, received array',
              code: 'invalid_type',
              expected: 'object',
              received: 'array',
              path: [],
            },
          ],
        },
        success: false,
      });

      expect(Schema.safeParse('{')).toMatchObject({
        error: {
          issues: [
            {
              message: 'Invalid JSONC',
              code: 'custom',
              path: [],
            },
          ],
        },
        success: false,
      });
    });
  });

  describe('UtcDate', () => {
    it('parses date', () => {
      expect(UtcDate.parse('2020-04-04').toString()).toBe(
        '2020-04-04T00:00:00.000Z',
      );
    });

    it('rejects invalid date', () => {
      expect(() => UtcDate.parse('foobar')).toThrow();
    });
  });

  describe('Yaml', () => {
    const Schema = Yaml.pipe(
      z.object({ foo: z.array(z.object({ bar: z.literal('baz') })) }),
    );

    it('parses valid yaml', () => {
      expect(Schema.parse('foo:\n- bar: baz')).toEqual({
        foo: [{ bar: 'baz' }],
      });
    });

    it('throws error for non-string', () => {
      expect(Schema.safeParse(42)).toMatchObject({
        error: {
          issues: [
            {
              message: 'Expected string, received number',
              code: 'invalid_type',
              expected: 'string',
              received: 'number',
              path: [],
            },
          ],
        },
        success: false,
      });
    });

    it('throws error for invalid yaml', () => {
      expect(Schema.safeParse('clearly: "invalid" "yaml"')).toMatchObject({
        error: {
          issues: [
            {
              message: 'Invalid YAML',
              code: 'custom',
              path: [],
            },
          ],
        },
        success: false,
      });
    });
  });

  describe('MultidocYaml', () => {
    const Schema = MultidocYaml.pipe(
      z.array(
        z.object({
          foo: z.number(),
        }),
      ),
    );

    it('parses valid yaml', () => {
      expect(
        Schema.parse(codeBlock`
          foo: 111
          ---
          foo: 222
        `),
      ).toEqual([{ foo: 111 }, { foo: 222 }]);
    });

    it('throws error for non-string', () => {
      expect(Schema.safeParse(42)).toMatchObject({
        error: {
          issues: [
            {
              message: 'Expected string, received number',
              code: 'invalid_type',
              expected: 'string',
              received: 'number',
              path: [],
            },
          ],
        },
        success: false,
      });
    });

    it('throws error for invalid yaml', () => {
      expect(Schema.safeParse('clearly: "invalid" "yaml"')).toMatchObject({
        error: {
          issues: [
            {
              message: 'Invalid YAML',
              code: 'custom',
              path: [],
            },
          ],
        },
        success: false,
      });
    });
  });

  describe('multidocYaml()', () => {
    const Schema = multidocYaml().pipe(
      z.array(
        z.object({
          foo: z.number(),
        }),
      ),
    );

    it('parses valid yaml', () => {
      expect(
        Schema.parse(codeBlock`
          foo: 111
          ---
          foo: 222
        `),
      ).toEqual([{ foo: 111 }, { foo: 222 }]);
    });
  });

  describe('Toml', () => {
    const Schema = Toml.pipe(
      z.object({ foo: z.object({ bar: z.literal('baz') }) }),
    );

    it('parses valid toml', () => {
      const content = codeBlock`
        [foo]
        bar = "baz"
      `;
      expect(Schema.parse(content)).toEqual({
        foo: { bar: 'baz' },
      });
    });

    it('throws error for invalid schema', () => {
      const content = codeBlock`
        [foo]
        bar = "brb"
      `;
      expect(Schema.safeParse(content)).toMatchObject({
        error: {
          issues: [
            {
              received: 'brb',
              code: 'invalid_literal',
              expected: 'baz',
              path: ['foo', 'bar'],
            },
          ],
        },
        success: false,
      });
    });

    it('throws error for invalid toml', () => {
      expect(Schema.safeParse('clearly_invalid')).toMatchObject({
        error: {
          issues: [
            {
              message: 'Invalid TOML',
              code: 'custom',
              path: [],
            },
          ],
        },
        success: false,
      });
    });
  });

  describe('logging utils', () => {
    it('logs debug message and returns fallback value', () => {
      const Schema = z
        .string()
        .catch(withDebugMessage('default string', 'Debug message'));

      const result = Schema.parse(42);

      expect(result).toBe('default string');
      expect(logger.logger.debug).toHaveBeenCalledWith(
        { err: expect.any(z.ZodError) },
        'Debug message',
      );
    });

    it('logs trace message and returns fallback value', () => {
      const Schema = z
        .string()
        .catch(withTraceMessage('default string', 'Trace message'));

      const result = Schema.parse(42);

      expect(result).toBe('default string');
      expect(logger.logger.trace).toHaveBeenCalledWith(
        { err: expect.any(z.ZodError) },
        'Trace message',
      );
    });
  });

  describe('NotCircular', () => {
    it('allows non-circular primitive values', () => {
      const Schema = NotCircular.pipe(z.any());

      expect(Schema.parse(undefined)).toBeUndefined();
      expect(Schema.parse(null)).toBeNull();
      expect(Schema.parse(123)).toBe(123);
      expect(Schema.parse('string')).toBe('string');
      expect(Schema.parse(true)).toBe(true);
    });

    it('allows non-circular arrays', () => {
      const Schema = NotCircular.pipe(z.any());

      expect(Schema.parse([1, 2, 3])).toEqual([1, 2, 3]);
      expect(Schema.parse([{ a: 1 }, { b: 2 }])).toEqual([{ a: 1 }, { b: 2 }]);
      expect(
        Schema.parse([
          [1, 2],
          [3, 4],
        ]),
      ).toEqual([
        [1, 2],
        [3, 4],
      ]);
    });

    it('allows non-circular objects', () => {
      const Schema = NotCircular.pipe(z.any());

      expect(Schema.parse({ a: 1, b: 2 })).toEqual({ a: 1, b: 2 });
      expect(Schema.parse({ a: { b: 1 }, c: { d: 2 } })).toEqual({
        a: { b: 1 },
        c: { d: 2 },
      });
    });

    it('allows objects reuse', () => {
      const Schema = NotCircular.pipe(z.any());

      const reused = { value: 42 };
      const obj = {
        foo: reused,
        bar: reused,
      };

      expect(Schema.parse(obj)).toEqual({
        foo: { value: 42 },
        bar: { value: 42 },
      });
    });

    it('rejects circular objects', () => {
      const Schema = NotCircular.pipe(z.any());

      const obj: any = { a: 1 };
      obj.self = obj;

      expect(Schema.safeParse(obj)).toMatchObject({
        success: false,
        error: {
          issues: [
            {
              code: 'custom',
              message: 'values cannot be circular data structures',
              path: [],
            },
          ],
        },
      });
    });

    it('rejects circular arrays', () => {
      const Schema = NotCircular.pipe(z.any());

      const arr: any[] = [1, 2, 3];
      arr.push(arr);

      expect(Schema.safeParse(arr)).toMatchObject({
        success: false,
        error: {
          issues: [
            {
              code: 'custom',
              message: 'values cannot be circular data structures',
              path: [],
            },
          ],
        },
      });
    });

    it('rejects deeply nested circular references', () => {
      const Schema = NotCircular.pipe(z.any());

      const obj: any = {
        a: {
          b: {
            c: {
              d: {},
            },
          },
        },
      };

      obj.a.b.c.d.circular = obj.a;

      expect(Schema.safeParse(obj)).toMatchObject({
        success: false,
        error: {
          issues: [
            {
              code: 'custom',
              message: 'values cannot be circular data structures',
              path: [],
            },
          ],
        },
      });
    });

    it('can be combined with other schema types', () => {
      const Schema = z.object({
        data: NotCircular.pipe(z.any()),
      });

      expect(Schema.parse({ data: { a: 1, b: 2 } })).toEqual({
        data: { a: 1, b: 2 },
      });

      const obj: any = { a: 1 };
      obj.self = obj;

      expect(Schema.safeParse({ data: obj })).toMatchObject({
        success: false,
        error: {
          issues: [
            {
              code: 'custom',
              message: 'values cannot be circular data structures',
              path: ['data'],
            },
          ],
        },
      });
    });
  });
});
