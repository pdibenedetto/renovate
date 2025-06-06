import { codeBlock } from 'common-tags';
import { DateTime } from 'luxon';
import {
  EXTERNAL_HOST_ERROR,
  PLATFORM_BAD_CREDENTIALS,
  PLATFORM_INTEGRATION_UNAUTHORIZED,
  PLATFORM_RATE_LIMIT_EXCEEDED,
  REPOSITORY_CHANGED,
} from '../../constants/error-messages';
import { GithubReleasesDatasource } from '../../modules/datasource/github-releases';
import * as _repositoryCache from '../cache/repository';
import type { RepoCacheData } from '../cache/repository/types';
import * as hostRules from '../host-rules';
import { GithubHttp, setBaseUrl } from './github';
import type { GraphqlPageCache } from './github';
import * as httpMock from '~test/http-mock';
import { logger } from '~test/util';

vi.mock('../cache/repository');
const repositoryCache = vi.mocked(_repositoryCache);

const githubApiHost = 'https://api.github.com';

const graphqlQuery = codeBlock`
  query(
    $owner: String!,
    $name: String!,
    $count: Int,
    $cursor: String
  ) {
    repository(owner: $name, name: $name) {
      testItem (
        orderBy: { field: UPDATED_AT, direction: DESC },
        filterBy: { createdBy: "someone" },
        first: $count,
        after: $cursor,
      ) {
        pageInfo {
          endCursor
          hasNextPage
        }
        nodes {
          number state title body
        }
      }
    }
  }
`;

describe('util/http/github', () => {
  let githubApi: GithubHttp;
  let repoCache: RepoCacheData = {};

  beforeEach(() => {
    delete process.env.RENOVATE_X_REBASE_PAGINATION_LINKS;
    githubApi = new GithubHttp();
    setBaseUrl(githubApiHost);
    repoCache = {};
    repositoryCache.getCache.mockReturnValue(repoCache);
  });

  afterEach(() => {
    hostRules.clear();
  });

  describe('HTTP', () => {
    it('supports app mode', async () => {
      hostRules.add({ hostType: 'github', token: 'x-access-token:123test' });
      httpMock.scope(githubApiHost).get('/some-url').reply(200);
      await githubApi.get('/some-url', {
        headers: { accept: 'some-accept' },
      });
      const [req] = httpMock.getTrace();
      expect(req).toBeDefined();
      expect(req.headers.accept).toBe(
        'some-accept, application/vnd.github.machine-man-preview+json',
      );
      expect(req.headers.authorization).toBe('token 123test');
    });

    it('supports different datasources', async () => {
      const githubApiDatasource = new GithubHttp(GithubReleasesDatasource.id);
      hostRules.add({ hostType: 'github', token: 'abc' });
      hostRules.add({
        hostType: GithubReleasesDatasource.id,
        token: 'def',
      });
      httpMock.scope(githubApiHost).get('/some-url').reply(200);
      await githubApiDatasource.get('/some-url');
      const [req] = httpMock.getTrace();
      expect(req).toBeDefined();
      expect(req.headers.authorization).toBe('token def');
    });

    it('paginates', async () => {
      const url = '/some-url?per_page=2';
      httpMock
        .scope(githubApiHost)
        .get(url)
        .reply(200, ['a', 'b'], {
          link: `<${url}&page=2>; rel="next", <${url}&page=3>; rel="last"`,
        })
        .get(`${url}&page=2`)
        .reply(200, ['c', 'd'], {
          link: `<${url}&page=3>; rel="next", <${url}&page=3>; rel="last"`,
        })
        .get(`${url}&page=3`)
        .reply(200, ['e']);
      const res = await githubApi.getJsonUnchecked(url, { paginate: true });
      expect(res.body).toEqual(['a', 'b', 'c', 'd', 'e']);
    });

    it('uses paginationField', async () => {
      const url = '/some-url';
      httpMock
        .scope(githubApiHost)
        .get(url)
        .reply(
          200,
          { the_field: ['a'], total: 4 },
          {
            link: `<${url}?page=2>; rel="next", <${url}?page=3>; rel="last"`,
          },
        )
        .get(`${url}?page=2`)
        .reply(
          200,
          { the_field: ['b', 'c'], total: 4 },
          {
            link: `<${url}?page=3>; rel="next", <${url}?page=3>; rel="last"`,
          },
        )
        .get(`${url}?page=3`)
        .reply(200, { the_field: ['d'], total: 4 });
      const res = await githubApi.getJsonUnchecked<any>('some-url', {
        paginate: true,
        paginationField: 'the_field',
      });
      expect(res.body.the_field).toEqual(['a', 'b', 'c', 'd']);
    });

    it('paginates with auth and repo', async () => {
      const url = '/some-url?per_page=2';
      hostRules.add({
        hostType: 'github',
        token: 'test',
        matchHost: 'github.com',
      });
      hostRules.add({
        hostType: 'github',
        token: 'abc',
        matchHost: 'https://api.github.com/repos/some/repo',
      });
      httpMock
        .scope(githubApiHost, {
          reqheaders: {
            authorization: 'token abc',
            accept: 'application/json, application/vnd.github.v3+json',
          },
        })
        .get(url)
        .reply(200, ['a', 'b'], {
          link: `<${url}&page=2>; rel="next", <${url}&page=3>; rel="last"`,
        })
        .get(`${url}&page=2`)
        .reply(200, ['c', 'd'], {
          link: `<${url}&page=3>; rel="next", <${url}&page=3>; rel="last"`,
        })
        .get(`${url}&page=3`)
        .reply(200, ['e']);
      const res = await githubApi.getJsonUnchecked(url, {
        paginate: true,
        repository: 'some/repo',
      });
      expect(res.body).toEqual(['a', 'b', 'c', 'd', 'e']);
    });

    it('paginates with auth and repo on GHE', async () => {
      const url = '/api/v3/some-url?per_page=2';
      hostRules.add({
        hostType: 'github',
        token: 'test',
        matchHost: 'github.domain.com',
      });
      hostRules.add({
        hostType: 'github',
        token: 'abc',
        matchHost: 'https://github.domain.com/api/v3/repos/some/repo',
      });
      httpMock
        .scope('https://github.domain.com', {
          reqheaders: {
            authorization: 'token abc',
            accept:
              'application/vnd.github.antiope-preview+json, application/vnd.github.v3+json',
          },
        })
        .get(url)
        .reply(200, ['a', 'b'], {
          link: `<${url}&page=2>; rel="next", <${url}&page=3>; rel="last"`,
        })
        .get(`${url}&page=2`)
        .reply(200, ['c', 'd'], {
          link: `<${url}&page=3>; rel="next", <${url}&page=3>; rel="last"`,
        })
        .get(`${url}&page=3`)
        .reply(200, ['e']);
      const res = await githubApi.getJsonUnchecked(url, {
        paginate: true,
        repository: 'some/repo',
        baseUrl: 'https://github.domain.com',
        headers: {
          accept: 'application/vnd.github.antiope-preview+json',
        },
      });
      expect(res.body).toEqual(['a', 'b', 'c', 'd', 'e']);
    });

    it('attempts to paginate', async () => {
      const url = '/some-url';
      httpMock
        .scope(githubApiHost)
        .get(url)
        .reply(200, ['a'], {
          link: `<${url}?page=34>; rel="last"`,
        });
      const res = await githubApi.getJsonUnchecked('some-url', {
        paginate: true,
      });
      expect(res).toBeDefined();
      expect(res.body).toEqual(['a']);
    });

    it('rebases GHE Server pagination links', async () => {
      process.env.RENOVATE_X_REBASE_PAGINATION_LINKS = '1';
      // The origin and base URL which Renovate uses (from its config) to reach GHE:
      const baseUrl = 'http://ghe.alternative.domain.com/api/v3';
      setBaseUrl(baseUrl);
      // The hostname from GHE settings, which users use through their browsers to reach GHE:
      // https://docs.github.com/en/enterprise-server@3.5/admin/configuration/configuring-network-settings/configuring-a-hostname
      const gheHostname = 'ghe.mycompany.com';
      // GHE replies to paginated requests with a Link response header whose URLs have this base
      const gheBaseUrl = `https://${gheHostname}/api/v3`;
      const apiUrl = '/some-url?per_page=2';
      httpMock
        .scope(baseUrl)
        .get(apiUrl)
        .reply(200, ['a', 'b'], {
          link: `<${gheBaseUrl}${apiUrl}&page=2>; rel="next", <${gheBaseUrl}${apiUrl}&page=3>; rel="last"`,
        })
        .get(`${apiUrl}&page=2`)
        .reply(200, ['c', 'd'], {
          link: `<${gheBaseUrl}${apiUrl}&page=3>; rel="next", <${gheBaseUrl}${apiUrl}&page=3>; rel="last"`,
        })
        .get(`${apiUrl}&page=3`)
        .reply(200, ['e']);
      const res = await githubApi.getJsonUnchecked(apiUrl, {
        paginate: true,
      });
      expect(res.body).toEqual(['a', 'b', 'c', 'd', 'e']);
    });

    it('preserves pagination links by default', async () => {
      const baseUrl = 'http://ghe.alternative.domain.com/api/v3';
      setBaseUrl(baseUrl);
      const apiUrl = '/some-url?per_page=2';
      httpMock
        .scope(baseUrl)
        .get(apiUrl)
        .reply(200, ['a', 'b'], {
          link: `<${baseUrl}${apiUrl}&page=2>; rel="next", <${baseUrl}${apiUrl}&page=3>; rel="last"`,
        })
        .get(`${apiUrl}&page=2`)
        .reply(200, ['c', 'd'], {
          link: `<${baseUrl}${apiUrl}&page=3>; rel="next", <${baseUrl}${apiUrl}&page=3>; rel="last"`,
        })
        .get(`${apiUrl}&page=3`)
        .reply(200, ['e']);
      const res = await githubApi.getJsonUnchecked(apiUrl, {
        paginate: true,
      });
      expect(res.body).toEqual(['a', 'b', 'c', 'd', 'e']);
    });

    it('preserves pagination links for github.com', async () => {
      process.env.RENOVATE_X_REBASE_PAGINATION_LINKS = '1';
      const baseUrl = 'https://api.github.com/';

      setBaseUrl(baseUrl);
      const apiUrl = 'some-url?per_page=2';
      httpMock
        .scope(baseUrl)
        .get('/' + apiUrl)
        .reply(200, ['a', 'b'], {
          link: `<${baseUrl}${apiUrl}&page=2>; rel="next", <${baseUrl}${apiUrl}&page=3>; rel="last"`,
        })
        .get(`/${apiUrl}&page=2`)
        .reply(200, ['c', 'd'], {
          link: `<${baseUrl}${apiUrl}&page=3>; rel="next", <${baseUrl}${apiUrl}&page=3>; rel="last"`,
        })
        .get(`/${apiUrl}&page=3`)
        .reply(200, ['e']);
      const res = await githubApi.getJsonUnchecked(apiUrl, {
        paginate: true,
      });
      expect(res.body).toEqual(['a', 'b', 'c', 'd', 'e']);
    });

    describe('handleGotError', () => {
      it('should log a once warning for github.com 401', async () => {
        await expect(
          fail(401, { message: 'Some unauthorized' }),
        ).rejects.toThrow('Response code 401 (Some unauthorized)');
        expect(logger.logger.once.warn).toHaveBeenCalled();
      });
      async function fail(
        code: number,
        body: any = undefined,
        headers: httpMock.ReplyHeaders = {},
      ) {
        const url = '/some-url';
        httpMock
          .scope(githubApiHost)
          .get(url)
          .reply(
            code,
            function reply() {
              // https://github.com/nock/nock/issues/1979
              if (typeof body === 'object' && 'message' in body) {
                (this.req as any).response.statusMessage = body?.message;
              }
              return body;
            },
            headers,
          );
        await githubApi.getJsonUnchecked(url);
      }

      async function failWithError(error: string | Record<string, unknown>) {
        const url = '/some-url';
        httpMock
          .scope(githubApiHost)
          .get(url)
          .replyWithError(httpMock.error(error));
        await githubApi.getJsonUnchecked(url);
      }

      it('should throw Not found', async () => {
        await expect(fail(404)).rejects.toThrow(
          'Response code 404 (Not Found)',
        );
      });

      it('should throw 410', async () => {
        await expect(
          fail(410, { message: 'Issues are disabled for this repo' }),
        ).rejects.toThrow(
          'Response code 410 (Issues are disabled for this repo)',
        );
      });

      it('should throw rate limit exceeded', async () => {
        await expect(
          fail(403, {
            message:
              'Error updating branch: API rate limit exceeded for installation ID 48411. (403)',
          }),
        ).rejects.toThrow(PLATFORM_RATE_LIMIT_EXCEEDED);
      });

      it('should throw secondary rate limit exceeded', async () => {
        await expect(
          fail(403, {
            message:
              'You have exceeded a secondary rate limit and have been temporarily blocked from content creation. Please retry your request again later.',
          }),
        ).rejects.toThrow(PLATFORM_RATE_LIMIT_EXCEEDED);
      });

      it('should throw Bad credentials', async () => {
        await expect(
          fail(401, { message: 'Bad credentials. (401)' }),
        ).rejects.toThrow(PLATFORM_BAD_CREDENTIALS);
      });

      it('should throw platform failure', async () => {
        await expect(
          fail(
            401,
            { message: 'Bad credentials. (401)' },
            {
              'x-ratelimit-limit': '60',
            },
          ),
        ).rejects.toThrow(EXTERNAL_HOST_ERROR);
      });

      it('should throw platform failure for ENOTFOUND, ETIMEDOUT or EAI_AGAIN', async () => {
        const codes = ['ENOTFOUND', 'ETIMEDOUT', 'EAI_AGAIN'];
        for (const code of codes) {
          await expect(failWithError({ code })).rejects.toThrow(
            EXTERNAL_HOST_ERROR,
          );
        }
      });

      it('should throw platform failure for 500', async () => {
        await expect(fail(500)).rejects.toThrow(EXTERNAL_HOST_ERROR);
      });

      it('should throw platform failure ParseError', async () => {
        await expect(fail(200, '{{')).rejects.toThrow(EXTERNAL_HOST_ERROR);
      });

      it('should throw for unauthorized integration', async () => {
        await expect(
          fail(403, {
            message: 'Resource not accessible by integration (403)',
          }),
        ).rejects.toThrow(PLATFORM_INTEGRATION_UNAUTHORIZED);
      });

      it('should throw for unauthorized integration2', async () => {
        await expect(
          fail(403, { message: 'Upgrade to GitHub Pro' }),
        ).rejects.toThrow('Upgrade to GitHub Pro');
      });

      it('should throw on abuse', async () => {
        await expect(
          fail(403, {
            message: 'You have triggered an abuse detection mechanism',
          }),
        ).rejects.toThrow(PLATFORM_RATE_LIMIT_EXCEEDED);
      });

      it('should throw on repository change', async () => {
        await expect(
          fail(422, {
            message: 'foobar',
            errors: [{ code: 'invalid' }],
          }),
        ).rejects.toThrow(REPOSITORY_CHANGED);
      });

      it('should throw platform failure on 422 response', async () => {
        await expect(
          fail(422, {
            message: 'foobar',
          }),
        ).rejects.toThrow(EXTERNAL_HOST_ERROR);
      });

      it('should throw original error when failed to add reviewers', async () => {
        await expect(
          fail(422, {
            message: 'Review cannot be requested from pull request author.',
          }),
        ).rejects.toThrow(
          'Review cannot be requested from pull request author.',
        );
      });

      it('should throw original error when pull requests aleady existed', async () => {
        await expect(
          fail(422, {
            message: 'Validation error',
            errors: [{ message: 'A pull request already exists' }],
          }),
        ).rejects.toThrow('Validation error');
      });

      it('should throw original error of unknown type', async () => {
        await expect(
          fail(418, {
            message: 'Sorry, this is a teapot',
          }),
        ).rejects.toThrow('Sorry, this is a teapot');
      });

      it('should throw original error when milestone not found', async () => {
        const milestoneNotFoundError = {
          message: 'Validation Failed',
          errors: [
            {
              value: 1,
              resource: 'Issue',
              field: 'milestone',
              code: 'invalid',
            },
          ],
          documentation_url:
            'https://docs.github.com/rest/issues/issues#update-an-issue',
        };

        await expect(fail(422, milestoneNotFoundError)).rejects.toThrow(
          'Validation Failed',
        );
      });
    });
  });

  describe('GraphQL', () => {
    const page1 = {
      data: {
        repository: {
          testItem: {
            pageInfo: {
              endCursor: 'cursor1',
              hasNextPage: true,
            },
            nodes: [
              {
                number: 1,
                state: 'OPEN',
                title: 'title-1',
                body: 'the body 1',
              },
            ],
          },
        },
      },
    };

    const page2 = {
      data: {
        repository: {
          testItem: {
            pageInfo: {
              endCursor: 'cursor2',
              hasNextPage: true,
            },
            nodes: [
              {
                number: 2,
                state: 'CLOSED',
                title: 'title-2',
                body: 'the body 2',
              },
            ],
          },
        },
      },
    };

    const page3 = {
      data: {
        repository: {
          testItem: {
            pageInfo: {
              endCursor: 'cursor3',
              hasNextPage: false,
            },
            nodes: [
              {
                number: 3,
                state: 'OPEN',
                title: 'title-3',
                body: 'the body 3',
              },
            ],
          },
        },
      },
    };

    it('strips path from baseUrl', async () => {
      setBaseUrl('https://ghe.mycompany.com/api/v3/');
      const repository = { foo: 'foo', bar: 'bar' };
      httpMock
        .scope('https://ghe.mycompany.com')
        .post('/api/graphql')
        .reply(200, { data: { repository } });
      await githubApi.requestGraphql(graphqlQuery, { token: 'abc' });
      const [req] = httpMock.getTrace();
      expect(req).toBeDefined();
      expect(req.url).toBe('https://ghe.mycompany.com/api/graphql');
    });

    it('supports app mode', async () => {
      hostRules.add({ hostType: 'github', token: 'x-access-token:123test' });
      httpMock
        .scope(githubApiHost)
        .post('/graphql')
        .reply(200, { data: { repository: { testItem: 'XXX' } } });
      await githubApi.queryRepoField(graphqlQuery, 'testItem', {
        paginate: false,
      });
      const [req] = httpMock.getTrace();
      expect(req).toBeDefined();
      expect(req.headers.accept).toBe(
        'application/vnd.github.machine-man-preview+json',
      );
    });

    it('returns empty array for undefined data', async () => {
      httpMock
        .scope(githubApiHost)
        .post('/graphql')
        .reply(200, {
          data: {
            someprop: 'someval',
          },
        });
      expect(
        await githubApi.queryRepoField(graphqlQuery, 'testItem', {
          paginate: false,
        }),
      ).toEqual([]);
    });

    it('returns empty array for undefined data.', async () => {
      httpMock
        .scope(githubApiHost)
        .post('/graphql')
        .reply(200, {
          data: { repository: { otherField: 'someval' } },
        });
      expect(
        await githubApi.queryRepoField(graphqlQuery, 'testItem', {
          paginate: false,
        }),
      ).toEqual([]);
    });

    it('throws errors for invalid responses', async () => {
      httpMock.scope(githubApiHost).post('/graphql').reply(418);
      await expect(
        githubApi.queryRepoField(graphqlQuery, 'someItem', {
          paginate: false,
        }),
      ).rejects.toThrow("Response code 418 (I'm a Teapot)");
    });

    it('halves node count and retries request', async () => {
      httpMock
        .scope(githubApiHost)
        .persist()
        .post('/graphql')
        .reply(200, {
          data: {
            someprop: 'someval',
          },
        });
      expect(
        await githubApi.queryRepoField(graphqlQuery, 'testItem'),
      ).toMatchInlineSnapshot(`[]`);
    });

    it('queryRepo', async () => {
      const repository = {
        foo: 'foo',
        bar: 'bar',
      };
      httpMock
        .scope(githubApiHost)
        .post('/graphql')
        .reply(200, { data: { repository } });

      const res = await githubApi.requestGraphql(graphqlQuery);
      expect(res?.data).toEqual({ repository });
    });

    it('queryRepoField', async () => {
      httpMock
        .scope(githubApiHost)
        .post('/graphql')
        .reply(200, page1)
        .post('/graphql')
        .reply(200, page2)
        .post('/graphql')
        .reply(200, page3);

      const items = await githubApi.queryRepoField(graphqlQuery, 'testItem');
      expect(items).toHaveLength(3);
    });

    it('limit result size', async () => {
      httpMock
        .scope(githubApiHost)
        .post('/graphql')
        .reply(200, page1)
        .post('/graphql')
        .reply(200, page2);

      const items = await githubApi.queryRepoField(graphqlQuery, 'testItem', {
        limit: 2,
      });
      expect(items).toHaveLength(2);
    });

    it('shrinks items count on 50x', async () => {
      repoCache.platform ??= {};
      repoCache.platform.github ??= {};
      repoCache.platform.github.graphqlPageCache = {
        testItem: {
          pageLastResizedAt: DateTime.local().toISO(),
          pageSize: 50,
        },
      };

      httpMock
        .scope(githubApiHost)
        .post('/graphql')
        .reply(200, page1)
        .post('/graphql')
        .reply(500)
        .post('/graphql')
        .reply(200, page2)
        .post('/graphql')
        .reply(200, page3);

      const items = await githubApi.queryRepoField(graphqlQuery, 'testItem');
      expect(items).toHaveLength(3);

      const graphqlPageCache = repoCache?.platform?.github
        ?.graphqlPageCache as GraphqlPageCache;
      expect(graphqlPageCache?.testItem?.pageSize).toBe(25);
    });

    it('expands items count on timeout', async () => {
      repoCache.platform ??= {};
      repoCache.platform.github ??= {};
      repoCache.platform.github.graphqlPageCache = {
        testItem: {
          pageLastResizedAt: DateTime.local()
            .minus({ hours: 24, seconds: 1 })
            .toISO(),
          pageSize: 42,
        },
      };

      httpMock
        .scope(githubApiHost)
        .post('/graphql')
        .reply(200, page1)
        .post('/graphql')
        .reply(200, page2)
        .post('/graphql')
        .reply(200, page3);

      const items = await githubApi.queryRepoField(graphqlQuery, 'testItem');
      expect(items).toHaveLength(3);
      const graphqlPageCache = repoCache?.platform?.github
        ?.graphqlPageCache as GraphqlPageCache;
      expect(graphqlPageCache?.testItem?.pageSize).toBe(84);
    });

    it('continues to iterate with a lower page size on error 502', async () => {
      httpMock
        .scope(githubApiHost)
        .post('/graphql')
        .reply(502)
        .post('/graphql')
        .reply(200, page1)
        .post('/graphql')
        .reply(200, page2)
        .post('/graphql')
        .reply(200, page3);

      const items = await githubApi.queryRepoField(graphqlQuery, 'testItem');
      expect(items).toHaveLength(3);
    });

    it('removes cache record once expanded to the maximum', async () => {
      repoCache.platform ??= {};
      repoCache.platform.github ??= {};
      repoCache.platform.github.graphqlPageCache = {
        testItem: {
          pageLastResizedAt: DateTime.local()
            .minus({ hours: 24, seconds: 1 })
            .toISO(),
          pageSize: 50,
        },
      };

      httpMock
        .scope(githubApiHost)
        .post('/graphql')
        .reply(200, page1)
        .post('/graphql')
        .reply(200, page2)
        .post('/graphql')
        .reply(200, page3);

      const items = await githubApi.queryRepoField(graphqlQuery, 'testItem');
      expect(items).toHaveLength(3);
      const graphqlPageCache = repoCache?.platform?.github
        ?.graphqlPageCache as GraphqlPageCache;
      expect(graphqlPageCache?.testItem).toBeUndefined();
    });

    it('throws on 50x if count < 10', async () => {
      httpMock.scope(githubApiHost).post('/graphql').reply(500);
      await expect(
        githubApi.queryRepoField(graphqlQuery, 'testItem', {
          count: 9,
        }),
      ).rejects.toThrow(EXTERNAL_HOST_ERROR);
    });
  });

  describe('getRawFile()', () => {
    it('add header and return', async () => {
      httpMock
        .scope(githubApiHost)
        .get('/foo/bar/contents/lore/ipsum.txt')
        .matchHeader(
          'accept',
          'application/vnd.github.raw+json, application/vnd.github.v3+json',
        )
        .reply(200, 'foo');
      await expect(
        githubApi.getRawTextFile(
          `${githubApiHost}/foo/bar/contents/lore/ipsum.txt`,
        ),
      ).resolves.toMatchObject({
        body: 'foo',
      });
    });

    it('support relative path', async () => {
      httpMock
        .scope(githubApiHost)
        .get('/foo/bar/contents/lore/ipsum.txt')
        .matchHeader(
          'accept',
          'application/vnd.github.raw+json, application/vnd.github.v3+json',
        )
        .reply(200, 'foo');
      await expect(
        githubApi.getRawTextFile(
          `${githubApiHost}/foo/bar/contents/foo/../lore/ipsum.txt`,
        ),
      ).resolves.toMatchObject({
        body: 'foo',
      });
    });

    it('support default to api.github.com if no baseURL has been supplied', async () => {
      httpMock
        .scope(githubApiHost)
        .get('/foo/bar/contents/lore/ipsum.txt')
        .matchHeader(
          'accept',
          'application/vnd.github.raw+json, application/vnd.github.v3+json',
        )
        .reply(200, 'foo');
      await expect(
        githubApi.getRawTextFile(`foo/bar/contents/lore/ipsum.txt`),
      ).resolves.toMatchObject({
        body: 'foo',
      });
    });

    it('support custom host if a baseURL has been supplied', async () => {
      const customApiHost = 'https://my.comapny.com/api/v3/';
      httpMock
        .scope(customApiHost)
        .get('/foo/bar/contents/lore/ipsum.txt')
        .matchHeader(
          'accept',
          'application/vnd.github.raw+json, application/vnd.github.v3+json',
        )
        .reply(200, 'foo');
      await expect(
        githubApi.getRawTextFile(`foo/bar/contents/lore/ipsum.txt`, {
          baseUrl: customApiHost,
        }),
      ).resolves.toMatchObject({
        body: 'foo',
      });
    });

    it('support default to api.github.com if no baseURL, but repository has been supplied', async () => {
      httpMock
        .scope(githubApiHost)
        .get('/foo/bar/contents/lore/ipsum.txt')
        .matchHeader(
          'accept',
          'application/vnd.github.raw+json, application/vnd.github.v3+json',
        )
        .reply(200, 'foo');
      await expect(
        githubApi.getRawTextFile(`lore/ipsum.txt`, {
          repository: 'foo/bar',
        }),
      ).resolves.toMatchObject({
        body: 'foo',
      });
    });

    it('support custom host if a baseURL and repository has been supplied', async () => {
      const customApiHost = 'https://my.comapny.com/api/v3/';
      httpMock
        .scope(customApiHost)
        .get('/foo/bar/contents/lore/ipsum.txt')
        .matchHeader(
          'accept',
          'application/vnd.github.raw+json, application/vnd.github.v3+json',
        )
        .reply(200, 'foo');
      await expect(
        githubApi.getRawTextFile(`lore/ipsum.txt`, {
          baseUrl: customApiHost,
          repository: 'foo/bar',
        }),
      ).resolves.toMatchObject({
        body: 'foo',
      });
    });

    it('support default to api.github.com if content path is used', async () => {
      httpMock
        .scope(githubApiHost)
        .get('/foo/bar/contents/lore/ipsum.txt')
        .matchHeader(
          'accept',
          'application/vnd.github.raw+json, application/vnd.github.v3+json',
        )
        .reply(200, 'foo');
      await expect(
        githubApi.getRawTextFile(`foo/bar/contents/lore/ipsum.txt`),
      ).resolves.toMatchObject({
        body: 'foo',
      });
    });

    it('support custom host if content path is used', async () => {
      const customApiHost = 'https://my.comapny.com/api/v3/';
      httpMock
        .scope(customApiHost)
        .get('/foo/bar/contents/lore/ipsum.txt')
        .matchHeader(
          'accept',
          'application/vnd.github.raw+json, application/vnd.github.v3+json',
        )
        .reply(200, 'test');
      await expect(
        githubApi.getRawTextFile(`foo/bar/contents/lore/ipsum.txt`, {
          baseUrl: customApiHost,
        }),
      ).resolves.toMatchObject({
        body: 'test',
      });
    });
  });
});
