import { parse } from '@std/csv'
import { assert, assertEquals, assertThrows } from '@std/assert'
import { Alphabet, Codec, Converter, defaultConfig } from '../src/converter.js'
import { CheckSumChecker } from '../src/converter.js'

Deno.test('data.csv', async () => {
	const columns = ['base62', 'friendly'] as const
	const data = parse(await Deno.readTextFile('./tests/fixtures/data.csv'), { columns, skipFirstRow: true })
	const converter = new Converter()

	const msg = `Finished ${data.length} rows in`

	console.time(msg)

	for (const { base62, friendly } of data) {
		const converted = converter.convert(base62)
		assertEquals(converted, friendly)
		const roundTripped = converter.revert(converted)
		assertEquals(roundTripped, base62)
	}

	console.timeEnd(msg)
})

Deno.test('config', async (t) => {
	await t.step('check sum alphabet length is prime number', () => {
		assertPrime(new Codec(defaultConfig.checks.alphabet).radix)
	})

	await t.step('target and checksum alphabets are case insensitive', () => {
		for (const alphabet of [defaultConfig.target.alphabet, defaultConfig.checks.alphabet]) {
			assertEquals(alphabet.toLowerCase(), alphabet)
		}
	})

	await t.step('checksum alphabet begins with target alphabet', () => {
		assert(defaultConfig.checks.alphabet.startsWith(defaultConfig.target.alphabet))
		assert(defaultConfig.checks.alphabet.length > defaultConfig.target.alphabet.length)
	})
})

Deno.test('Alphabet', async (t) => {
	for (const [_name, alphabet] of Object.entries(Alphabet)) {
		const name = _name as keyof typeof Alphabet

		await t.step(name, async (t) => {
			await t.step('all chars unique', () => {
				assertEquals([...new Set([...alphabet])].join(''), alphabet)
			})

			await t.step('lexicographically sorted', () => {
				assertEquals(alphabet, [...alphabet].sort().join(''))
				assertEquals(alphabet, [...alphabet].sort((a, b) => a.codePointAt(0)! - b.codePointAt(0)!).join(''))
			})

			await t.step('only ASCII alphanumeric', () => {
				assert(!/[^0-9A-Za-z]/.test(alphabet))
			})
		})
	}
})

Deno.test('Codec', async (t) => {
	await t.step('decode', () => assertEquals(new Codec('01').decode('1101'), 13n))
	await t.step('encode', () => assertEquals(new Codec('01').encode(13n), '1101'))
	await t.step('radix', () => assertEquals(new Codec('01').radix, 2n))
	await t.step('chars', () => assertEquals(new Codec('01').chars, ['0', '1']))
	await t.step('zeroChar', () => assertEquals(new Codec('01').zeroChar, '0'))

	await t.step('invalid inputs', async (t) => {
		const codec = new Codec('01')

		await t.step('encoding negative number', () => void assertThrows(() => codec.encode(-1n)))
		await t.step('decoding char not in alphabet', () => void assertThrows(() => codec.decode('102')))
	})

	await t.step('zeros', () => {
		const repetitionCounts = [1, 5, 10]
		const alphabets = ['01', '0123456789', 'abc', '345678']
		for (const alphabet of alphabets) {
			const codec = new Codec(alphabet)

			// zero always encodes to empty string
			assertEquals(codec.encode(0n), '')
			// empty string always decodes to zero
			assertEquals(codec.decode(''), 0n)

			for (const count of repetitionCounts) {
				// any number of zero chars always decodes to zero
				const zeros = codec.zeroChar.repeat(count)
				assertEquals(codec.decode(zeros), 0n)
			}
		}
	})

	await t.step('parity with JS built-ins', () => {
		function makeAlphabet(radix: number) {
			if (radix > 36) throw new RangeError('max radix for JS built-ins is 36')
			return Array.from(
				{ length: radix },
				(_, i) => i < 10 ? String(i) : String.fromCodePoint(i - 10 + 'a'.codePointAt(0)!),
			).join('')
		}

		const radixes = [2, 10, 16, 36]
		for (const radix of radixes) {
			const nums = [0, 1, 10, 42, 99, 100, 999, 1000, radix, radix - 1, radix ** 2, radix ** 2 - 1]
			const codec = new Codec(makeAlphabet(radix))
			for (const num of nums) {
				const stringified = num.toString(radix)
				assertEquals(codec.encode(BigInt(num)) || codec.zeroChar, stringified)
				assertEquals(Number(codec.decode(stringified)), parseInt(stringified, radix))
			}
		}
	})

	await t.step('TS types', async (t) => {
		const codec = new Codec('01')
		const _decode: (x: string) => bigint = codec.decode.bind(codec)
		const _encode: (x: bigint) => string = codec.encode.bind(codec)
		const _alphabet: string = codec.alphabet
		const _chars: string[] = codec.chars
		const _radix: bigint = codec.radix
		const _values: Map<string, bigint> = codec.values
		const _zeroChar: string = codec.zeroChar

		await t.step('props are readonly', () => {
			void (() => {
				// @ts-expect-error read-only property
				// deno-lint-ignore no-self-assign
				codec.alphabet = codec.alphabet
				// @ts-expect-error read-only property
				// deno-lint-ignore no-self-assign
				codec.chars = codec.chars
				// @ts-expect-error read-only property
				// deno-lint-ignore no-self-assign
				codec.radix = codec.radix
				// @ts-expect-error read-only property
				// deno-lint-ignore no-self-assign
				codec.values = codec.values
				// @ts-expect-error read-only property
				// deno-lint-ignore no-self-assign
				codec.zeroChar = codec.zeroChar
			})
		})
	})
})

Deno.test('CheckSumChecker', async (t) => {
	await t.step('parity with ISBN-10', async () => {
		// Examples from https://gist.github.com/tonyallan/2e4cce9f16232eb6517e0eebca0da945
		const x = await Deno.readTextFile('./tests/fixtures/isbn-10.txt')
		const isbns = x.split('\n').map((x) => x.trim()).filter(Boolean)

		for (const isbn of isbns) {
			const digits = isbn.replaceAll('-', '')

			// we reverse the digits first due to ISBN-10 using LTR calculation logic
			// (whereas we use RTL to remain agnostic to number of places)
			const content = parseInt([...digits.slice(0, -1)].reverse().join(''))
			const _check = digits.at(-1)!
			const check = _check === 'X' ? 10 : parseInt(_check)

			const checker = new CheckSumChecker(10n, 11n)
			assertEquals(checker.getCheckSum(BigInt(content)), BigInt(check))
		}
	})
})

function assertPrime(num: bigint) {
	assert(isPrime(num), `${num} is not a prime number`)
}

function isPrime(num: bigint) {
	if ((num % 2n === 0n && num !== 2n) || num <= 1n) {
		return false
	}
	for (let i = 3n; i ** 2n <= num; i += 2n) {
		if (num % i === 0n) {
			return false
		}
	}
	return true
}
