const { test } = require('tap')
const requireInject = require('require-inject')

const mocks = {
  profile: {},
  output: () => {},
  log: {},
  readUserInfo: {},
}
const npm = {
  output: (...args) => mocks.output(...args),
}

const Token = requireInject('../../lib/token.js', {
  '../../lib/utils/otplease.js': (opts, fn) => {
    return Promise.resolve().then(() => fn(opts))
  },
  '../../lib/utils/read-user-info.js': mocks.readUserInfo,
  'npm-profile': mocks.profile,
  npmlog: mocks.log,
})

const token = new Token(npm)

const tokenWithMocks = (mockRequests) => {
  for (const mod in mockRequests) {
    if (mod === 'npm')
      mockRequests.npm = { ...npm, ...mockRequests.npm }
    else {
      if (typeof mockRequests[mod] === 'function')
        mocks[mod] = mockRequests[mod]
      else {
        for (const key in mockRequests[mod])
          mocks[mod][key] = mockRequests[mod][key]
      }
    }
  }

  const reset = () => {
    for (const mod in mockRequests) {
      if (mod !== 'npm') {
        if (typeof mockRequests[mod] === 'function')
          mocks[mod] = () => {}
        else {
          for (const key in mockRequests[mod])
            delete mocks[mod][key]
        }
      }
    }
  }

  const token = new Token(mockRequests.npm || npm)
  return [token, reset]
}

test('completion', (t) => {
  t.plan(5)

  const testComp = (argv, expect) => {
    t.resolveMatch(token.completion({ conf: { argv: { remain: argv } } }), expect, argv.join(' '))
  }

  testComp(['npm', 'token'], ['list', 'revoke', 'create'])
  testComp(['npm', 'token', 'list'], [])
  testComp(['npm', 'token', 'revoke'], [])
  testComp(['npm', 'token', 'create'], [])

  t.rejects(
    token.completion({ conf: { argv: { remain: ['npm', 'token', 'foobar'] } } }),
    { message: 'foobar not recognize' }
  )
})

test('token foobar', (t) => {
  t.plan(2)

  const [, reset] = tokenWithMocks({
    log: {
      gauge: {
        show: (name) => {
          t.equal(name, 'token', 'shows a gauge')
        },
      },
    },
  })

  t.tearDown(reset)

  token.exec(['foobar'], (err) => {
    t.match(err.message, 'foobar is not a recognized subcommand')
  })
})

test('token list', (t) => {
  t.plan(15)

  const now = new Date().toISOString()
  const tokens = [{
    key: 'abcd1234abcd1234',
    token: 'efgh5678efgh5678',
    cidr_whitelist: null,
    readonly: false,
    created: now,
    updated: now,
  }, {
    key: 'abcd1256',
    token: 'hgfe8765',
    cidr_whitelist: ['192.168.1.1/32'],
    readonly: true,
    created: now,
    updated: now,
  }]

  const [token, reset] = tokenWithMocks({
    npm: {
      flatOptions: { registry: 'https://registry.npmjs.org', otp: '123456' },
      config: {
        getCredentialsByURI: (uri) => {
          t.equal(uri, 'https://registry.npmjs.org', 'requests correct registry')
          return { token: 'thisisnotarealtoken' }
        },
      },
    },
    profile: {
      listTokens: (conf) => {
        t.same(conf.auth, { token: 'thisisnotarealtoken', otp: '123456' })
        return tokens
      },
    },
    log: {
      gauge: {
        show: (name) => {
          t.equal(name, 'token')
        },
      },
      info: (type, msg) => {
        t.equal(type, 'token')
        t.equal(msg, 'getting list')
      },
    },
    output: (spec) => {
      const lines = spec.split(/\r?\n/)
      t.match(lines[3], ' abcd123 ', 'includes the trimmed key')
      t.match(lines[3], ' efgh56??? ', 'includes the trimmed token')
      t.match(lines[3], ` ${now.slice(0, 10)} `, 'includes the trimmed creation timestamp')
      t.match(lines[3], ' no ', 'includes the "no" string for readonly state')
      t.match(lines[5], ' abcd125 ', 'includes the trimmed key')
      t.match(lines[5], ' hgfe87??? ', 'includes the trimmed token')
      t.match(lines[5], ` ${now.slice(0, 10)} `, 'includes the trimmed creation timestamp')
      t.match(lines[5], ' yes ', 'includes the "no" string for readonly state')
      t.match(lines[5], ` ${tokens[1].cidr_whitelist.join(',')} `, 'includes the cidr whitelist')
    },
  })

  t.tearDown(reset)

  token.exec([], (err) => {
    t.ifError(err, 'npm token list')
  })
})

test('token list json output', (t) => {
  t.plan(8)

  const now = new Date().toISOString()
  const tokens = [{
    key: 'abcd1234abcd1234',
    token: 'efgh5678efgh5678',
    cidr_whitelist: null,
    readonly: false,
    created: now,
    updated: now,
  }]

  const [token, reset] = tokenWithMocks({
    npm: {
      flatOptions: { registry: 'https://registry.npmjs.org', json: true },
      config: {
        getCredentialsByURI: (uri) => {
          t.equal(uri, 'https://registry.npmjs.org', 'requests correct registry')
          return { username: 'foo', password: 'bar' }
        },
      },
    },
    profile: {
      listTokens: (conf) => {
        t.same(conf.auth, { basic: { username: 'foo', password: 'bar' } }, 'passes the correct auth')
        return tokens
      },
    },
    log: {
      gauge: {
        show: (name) => {
          t.equal(name, 'token')
        },
      },
      info: (type, msg) => {
        t.equal(type, 'token')
        t.equal(msg, 'getting list')
      },
    },
    output: (spec) => {
      t.type(spec, 'string', 'is called with a string')
      const parsed = JSON.parse(spec)
      t.match(parsed, tokens, 'prints the json parsed tokens')
    },
  })

  t.tearDown(reset)

  token.exec(['list'], (err) => {
    t.ifError(err, 'npm token list')
  })
})

test('token list parseable output', (t) => {
  t.plan(12)

  const now = new Date().toISOString()
  const tokens = [{
    key: 'abcd1234abcd1234',
    token: 'efgh5678efgh5678',
    cidr_whitelist: null,
    readonly: false,
    created: now,
    updated: now,
  }, {
    key: 'efgh5678ijkl9101',
    token: 'hgfe8765',
    cidr_whitelist: ['192.168.1.1/32'],
    readonly: true,
    created: now,
    updated: now,
  }]

  let callCount = 0

  const [token, reset] = tokenWithMocks({
    npm: {
      flatOptions: { registry: 'https://registry.npmjs.org', parseable: true },
      config: {
        getCredentialsByURI: (uri) => {
          t.equal(uri, 'https://registry.npmjs.org', 'requests correct registry')
          return { auth: Buffer.from('foo:bar').toString('base64') }
        },
      },
    },
    profile: {
      listTokens: (conf) => {
        t.same(conf.auth, { basic: { username: 'foo', password: 'bar' } }, 'passes the correct auth')
        return tokens
      },
    },
    log: {
      gauge: {
        show: (name) => {
          t.equal(name, 'token')
        },
      },
      info: (type, msg) => {
        t.equal(type, 'token')
        t.equal(msg, 'getting list')
      },
    },
    output: (spec) => {
      ++callCount
      t.type(spec, 'string', 'is called with a string')
      if (callCount === 1)
        t.equal(spec, ['key', 'token', 'created', 'readonly', 'CIDR whitelist'].join('\t'), 'prints header')
      else if (callCount === 2)
        t.equal(spec, [tokens[0].key, tokens[0].token, tokens[0].created, tokens[0].readonly, ''].join('\t'), 'prints token info')
      else
        t.equal(spec, [tokens[1].key, tokens[1].token, tokens[1].created, tokens[1].readonly, tokens[1].cidr_whitelist.join(',')].join('\t'), 'prints token info')
    },
  })

  t.tearDown(reset)

  token.exec(['list'], (err) => {
    t.ifError(err, 'npm token list')
  })
})

test('token revoke', (t) => {
  t.plan(10)

  const [token, reset] = tokenWithMocks({
    npm: {
      flatOptions: { registry: 'https://registry.npmjs.org' },
      config: {
        getCredentialsByURI: (uri) => {
          t.equal(uri, 'https://registry.npmjs.org', 'requests correct registry')
          return {}
        },
      },
    },
    log: {
      gauge: {
        show: (name) => {
          t.equal(name, 'token', 'starts a gauge')
        },
      },
      newItem: (action, len) => {
        t.equal(action, 'removing tokens')
        t.equal(len, 0)
        return {
          info: (name, progress) => {
            t.equal(name, 'token')
            t.equal(progress, 'getting existing list')
          },
        }
      },
    },
    profile: {
      listTokens: (conf) => {
        t.same(conf.auth, {}, 'passes the correct empty auth')
        return Promise.resolve([
          { key: 'abcd1234' },
        ])
      },
      removeToken: (key) => {
        t.equal(key, 'abcd1234', 'deletes the correct token')
      },
    },
    output: (spec) => {
      t.equal(spec, 'Removed 1 token')
    },
  })

  t.tearDown(reset)

  token.exec(['rm', 'abcd'], (err) => {
    t.ifError(err, 'npm token rm')
  })
})

test('token revoke multiple tokens', (t) => {
  t.plan(10)

  const [token, reset] = tokenWithMocks({
    npm: {
      flatOptions: { registry: 'https://registry.npmjs.org' },
      config: {
        getCredentialsByURI: (uri) => {
          t.equal(uri, 'https://registry.npmjs.org', 'requests correct registry')
          return { token: 'thisisnotarealtoken' }
        },
      },
    },
    log: {
      gauge: {
        show: (name) => {
          t.equal(name, 'token', 'starts a gauge')
        },
      },
      newItem: (action, len) => {
        t.equal(action, 'removing tokens')
        t.equal(len, 0)
        return {
          info: (name, progress) => {
            t.equal(name, 'token')
            t.equal(progress, 'getting existing list')
          },
        }
      },
    },
    profile: {
      listTokens: () => Promise.resolve([
        { key: 'abcd1234' },
        { key: 'efgh5678' },
      ]),
      removeToken: (key) => {
        // this will run twice
        t.ok(['abcd1234', 'efgh5678'].includes(key), 'deletes the correct token')
      },
    },
    output: (spec) => {
      t.equal(spec, 'Removed 2 tokens')
    },
  })

  t.tearDown(reset)

  token.exec(['revoke', 'abcd', 'efgh'], (err) => {
    t.ifError(err, 'npm token rm')
  })
})

test('token revoke json output', (t) => {
  t.plan(10)

  const [token, reset] = tokenWithMocks({
    npm: {
      flatOptions: { registry: 'https://registry.npmjs.org', json: true },
      config: {
        getCredentialsByURI: (uri) => {
          t.equal(uri, 'https://registry.npmjs.org', 'requests correct registry')
          return { token: 'thisisnotarealtoken' }
        },
      },
    },
    log: {
      gauge: {
        show: (name) => {
          t.equal(name, 'token', 'starts a gauge')
        },
      },
      newItem: (action, len) => {
        t.equal(action, 'removing tokens')
        t.equal(len, 0)
        return {
          info: (name, progress) => {
            t.equal(name, 'token')
            t.equal(progress, 'getting existing list')
          },
        }
      },
    },
    profile: {
      listTokens: () => Promise.resolve([
        { key: 'abcd1234' },
      ]),
      removeToken: (key) => {
        t.equal(key, 'abcd1234', 'deletes the correct token')
      },
    },
    output: (spec) => {
      t.type(spec, 'string', 'is given a string')
      const parsed = JSON.parse(spec)
      t.same(parsed, ['abcd1234'], 'logs the token as json')
    },
  })

  t.tearDown(reset)

  token.exec(['delete', 'abcd'], (err) => {
    t.ifError(err, 'npm token rm')
  })
})

test('token revoke parseable output', (t) => {
  t.plan(9)

  const [token, reset] = tokenWithMocks({
    npm: {
      flatOptions: { registry: 'https://registry.npmjs.org', parseable: true },
      config: {
        getCredentialsByURI: (uri) => {
          t.equal(uri, 'https://registry.npmjs.org', 'requests correct registry')
          return { token: 'thisisnotarealtoken' }
        },
      },
    },
    log: {
      gauge: {
        show: (name) => {
          t.equal(name, 'token', 'starts a gauge')
        },
      },
      newItem: (action, len) => {
        t.equal(action, 'removing tokens')
        t.equal(len, 0)
        return {
          info: (name, progress) => {
            t.equal(name, 'token')
            t.equal(progress, 'getting existing list')
          },
        }
      },
    },
    profile: {
      listTokens: () => Promise.resolve([
        { key: 'abcd1234' },
      ]),
      removeToken: (key) => {
        t.equal(key, 'abcd1234', 'deletes the correct token')
      },
    },
    output: (spec) => {
      t.equal(spec, 'abcd1234', 'logs the token as a string')
    },
  })

  t.tearDown(reset)

  token.exec(['remove', 'abcd'], (err) => {
    t.ifError(err, 'npm token rm')
  })
})

test('token revoke by token', (t) => {
  t.plan(9)

  const [token, reset] = tokenWithMocks({
    npm: {
      flatOptions: { registry: 'https://registry.npmjs.org' },
      config: {
        getCredentialsByURI: (uri) => {
          t.equal(uri, 'https://registry.npmjs.org', 'requests correct registry')
          return { token: 'thisisnotarealtoken' }
        },
      },
    },
    log: {
      gauge: {
        show: (name) => {
          t.equal(name, 'token', 'starts a gauge')
        },
      },
      newItem: (action, len) => {
        t.equal(action, 'removing tokens')
        t.equal(len, 0)
        return {
          info: (name, progress) => {
            t.equal(name, 'token')
            t.equal(progress, 'getting existing list')
          },
        }
      },
    },
    profile: {
      listTokens: () => Promise.resolve([
        { key: 'abcd1234', token: 'efgh5678' },
      ]),
      removeToken: (key) => {
        t.equal(key, 'efgh5678', 'passes through user input')
      },
    },
    output: (spec) => {
      t.equal(spec, 'Removed 1 token')
    },
  })

  t.tearDown(reset)

  token.exec(['rm', 'efgh5678'], (err) => {
    t.ifError(err, 'npm token rm')
  })
})

test('token revoke requires an id', (t) => {
  t.plan(2)

  const [token, reset] = tokenWithMocks({
    log: {
      gauge: {
        show: (name) => {
          t.equal(name, 'token')
        },
      },
    },
  })

  t.tearDown(reset)

  token.exec(['rm'], (err) => {
    t.match(err.message, '`<tokenKey>` argument is required')
  })
})

test('token revoke ambiguous id errors', (t) => {
  t.plan(7)

  const [token, reset] = tokenWithMocks({
    npm: {
      flatOptions: { registry: 'https://registry.npmjs.org' },
      config: {
        getCredentialsByURI: (uri) => {
          t.equal(uri, 'https://registry.npmjs.org', 'requests correct registry')
          return { token: 'thisisnotarealtoken' }
        },
      },
    },
    log: {
      gauge: {
        show: (name) => {
          t.equal(name, 'token', 'starts a gauge')
        },
      },
      newItem: (action, len) => {
        t.equal(action, 'removing tokens')
        t.equal(len, 0)
        return {
          info: (name, progress) => {
            t.equal(name, 'token')
            t.equal(progress, 'getting existing list')
          },
        }
      },
    },
    profile: {
      listTokens: () => Promise.resolve([
        { key: 'abcd1234' },
        { key: 'abcd5678' },
      ]),
    },
  })

  t.tearDown(reset)

  token.exec(['rm', 'abcd'], (err) => {
    t.match(err.message, 'Token ID "abcd" was ambiguous')
  })
})

test('token revoke unknown id errors', (t) => {
  t.plan(7)

  const [token, reset] = tokenWithMocks({
    npm: {
      flatOptions: { registry: 'https://registry.npmjs.org' },
      config: {
        getCredentialsByURI: (uri) => {
          t.equal(uri, 'https://registry.npmjs.org', 'requests correct registry')
          return { token: 'thisisnotarealtoken' }
        },
      },
    },
    log: {
      gauge: {
        show: (name) => {
          t.equal(name, 'token', 'starts a gauge')
        },
      },
      newItem: (action, len) => {
        t.equal(action, 'removing tokens')
        t.equal(len, 0)
        return {
          info: (name, progress) => {
            t.equal(name, 'token')
            t.equal(progress, 'getting existing list')
          },
        }
      },
    },
    profile: {
      listTokens: () => Promise.resolve([
        { key: 'abcd1234' },
      ]),
    },
  })

  t.tearDown(reset)

  token.exec(['rm', 'efgh'], (err) => {
    t.match(err.message, 'Unknown token id or value "efgh".')
  })
})

test('token create', (t) => {
  t.plan(15)

  const now = new Date().toISOString()
  const password = 'thisisnotreallyapassword'

  const [token, reset] = tokenWithMocks({
    npm: {
      flatOptions: { registry: 'https://registry.npmjs.org', cidr: ['10.0.0.0/8', '192.168.1.0/24'] },
      config: {
        getCredentialsByURI: (uri) => {
          t.equal(uri, 'https://registry.npmjs.org', 'requests correct registry')
          return { token: 'thisisnotarealtoken' }
        },
      },
    },
    log: {
      gauge: {
        show: (name) => {
          t.equal(name, 'token', 'starts a gauge')
        },
      },
      info: (name, message) => {
        t.equal(name, 'token')
        t.equal(message, 'creating')
      },
    },
    readUserInfo: {
      password: () => Promise.resolve(password),
    },
    profile: {
      createToken: (pw, readonly, cidr) => {
        t.equal(pw, password)
        t.equal(readonly, undefined)
        t.same(cidr, ['10.0.0.0/8', '192.168.1.0/24'], 'defaults to empty array')
        return {
          key: 'abcd1234',
          token: 'efgh5678',
          created: now,
          updated: now,
          readonly: false,
          cidr_whitelist: [],
        }
      },
    },
    output: (spec) => {
      const lines = spec.split(/\r?\n/)
      t.match(lines[1], 'token')
      t.match(lines[1], 'efgh5678', 'prints the whole token')
      t.match(lines[3], 'created')
      t.match(lines[3], now, 'prints the correct timestamp')
      t.match(lines[5], 'readonly')
      t.match(lines[5], 'false', 'prints the readonly flag')
      t.match(lines[7], 'cidr_whitelist')
    },
  })

  t.tearDown(reset)

  token.exec(['create'], (err) => {
    t.ifError(err, 'npm token create')
  })
})

test('token create json output', (t) => {
  t.plan(10)

  const now = new Date().toISOString()
  const password = 'thisisnotreallyapassword'

  const [token, reset] = tokenWithMocks({
    npm: {
      flatOptions: { registry: 'https://registry.npmjs.org', json: true },
      config: {
        getCredentialsByURI: (uri) => {
          t.equal(uri, 'https://registry.npmjs.org', 'requests correct registry')
          return { token: 'thisisnotarealtoken' }
        },
      },
    },
    log: {
      gauge: {
        show: (name) => {
          t.equal(name, 'token', 'starts a gauge')
        },
      },
      info: (name, message) => {
        t.equal(name, 'token')
        t.equal(message, 'creating')
      },
    },
    readUserInfo: {
      password: () => Promise.resolve(password),
    },
    profile: {
      createToken: (pw, readonly, cidr) => {
        t.equal(pw, password)
        t.equal(readonly, undefined)
        t.same(cidr, [], 'defaults to empty array')
        return {
          key: 'abcd1234',
          token: 'efgh5678',
          created: now,
          updated: now,
          readonly: false,
          cidr_whitelist: [],
        }
      },
    },
    output: (spec) => {
      t.type(spec, 'string', 'outputs a string')
      const parsed = JSON.parse(spec)
      t.same(parsed, { token: 'efgh5678', created: now, readonly: false, cidr_whitelist: [] }, 'outputs the correct object')
    },
  })

  t.tearDown(reset)

  token.exec(['create'], (err) => {
    t.ifError(err, 'npm token create')
  })
})

test('token create parseable output', (t) => {
  t.plan(12)

  const now = new Date().toISOString()
  const password = 'thisisnotreallyapassword'

  let callCount = 0
  const [token, reset] = tokenWithMocks({
    npm: {
      flatOptions: { registry: 'https://registry.npmjs.org', parseable: true },
      config: {
        getCredentialsByURI: (uri) => {
          t.equal(uri, 'https://registry.npmjs.org', 'requests correct registry')
          return { token: 'thisisnotarealtoken' }
        },
      },
    },
    log: {
      gauge: {
        show: (name) => {
          t.equal(name, 'token', 'starts a gauge')
        },
      },
      info: (name, message) => {
        t.equal(name, 'token')
        t.equal(message, 'creating')
      },
    },
    readUserInfo: {
      password: () => Promise.resolve(password),
    },
    profile: {
      createToken: (pw, readonly, cidr) => {
        t.equal(pw, password)
        t.equal(readonly, undefined)
        t.same(cidr, [], 'defaults to empty array')
        return {
          key: 'abcd1234',
          token: 'efgh5678',
          created: now,
          updated: now,
          readonly: false,
          cidr_whitelist: [],
        }
      },
    },
    output: (spec) => {
      ++callCount
      if (callCount === 1)
        t.match(spec, 'token\tefgh5678', 'prints the token')
      else if (callCount === 2)
        t.match(spec, `created\t${now}`, 'prints the created timestamp')
      else if (callCount === 3)
        t.match(spec, 'readonly\tfalse', 'prints the readonly flag')
      else
        t.match(spec, 'cidr_whitelist\t', 'prints the cidr whitelist')
    },
  })

  t.tearDown(reset)

  token.exec(['create'], (err) => {
    t.ifError(err, 'npm token create')
  })
})

test('token create ipv6 cidr', (t) => {
  t.plan(4)

  const password = 'thisisnotreallyapassword'

  const [token, reset] = tokenWithMocks({
    npm: {
      flatOptions: { registry: 'https://registry.npmjs.org', cidr: '::1/128' },
      config: {
        getCredentialsByURI: (uri) => {
          t.equal(uri, 'https://registry.npmjs.org', 'requests correct registry')
          return { token: 'thisisnotarealtoken' }
        },
      },
    },
    log: {
      gauge: {
        show: (name) => {
          t.equal(name, 'token', 'starts a gauge')
        },
      },
    },
    readUserInfo: {
      password: () => Promise.resolve(password),
    },
  })

  t.tearDown(reset)

  token.exec(['create'], (err) => {
    t.equal(err.message, 'CIDR whitelist can only contain IPv4 addresses, ::1/128 is IPv6', 'returns correct error')
    t.equal(err.code, 'EINVALIDCIDR')
  })
})

test('token create invalid cidr', (t) => {
  t.plan(4)

  const password = 'thisisnotreallyapassword'

  const [token, reset] = tokenWithMocks({
    npm: {
      flatOptions: { registry: 'https://registry.npmjs.org', cidr: 'apple/cider' },
      config: {
        getCredentialsByURI: (uri) => {
          t.equal(uri, 'https://registry.npmjs.org', 'requests correct registry')
          return { token: 'thisisnotarealtoken' }
        },
      },
    },
    log: {
      gauge: {
        show: (name) => {
          t.equal(name, 'token', 'starts a gauge')
        },
      },
    },
    readUserInfo: {
      password: () => Promise.resolve(password),
    },
  })

  t.tearDown(reset)

  token.exec(['create'], (err) => {
    t.equal(err.message, 'CIDR whitelist contains invalid CIDR entry: apple/cider', 'returns correct error')
    t.equal(err.code, 'EINVALIDCIDR')
  })
})
