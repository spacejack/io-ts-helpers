# Nominal types and factories for io-ts

I have been exploring [io-ts](https://github.com/gcanti/io-ts) for a little while now, as a solution for validation and other run-time type checks. I've made a few observations along the way and some patterns are emerging from my use of it so far.

I shared some of these ideas with [@gcanti](https://github.com/gcanti) and he made some suggestions and improvements which I've included below.

## Branding Primitives

io-ts comes with a set of built-in primitive types as you'd expect: numbers, strings, booleans, etc. To validate a number type, you can use:

```typescript
t.number.decode(input)
```

If you want to [refine](https://github.com/gcanti/io-ts#refinements) that type - suppose we want a positive number - it's easy enough to do as per the example in the io-ts readme:

```typescript
const Positive = t.refinement(t.number, n => n >= 0, 'Positive')
```

Now we can do:

```typescript
Positive.decode(1)
```

The `Right` of the resulting `Either` will contain a valid positive number.

However, what if we do this:

```typescript
Positive.decode(1).map(p => {
    p = -1  // <- no error
})
```

There's nothing to stop us from breaking a previously valid type.

While TypeScript doesn't technically support nominal types, a technique called branding does allow us to approximate them. For example, we could declare:

```typescript
type Positive = number & {__Positive: never}
```

And a helper function to create valid positive types:

```typescript
function Positive (n: number) {
    if (typeof n !== 'number' || n < 0) {
        throw new Error('Invalid Positive number')
    }
    return n as Positive
}
```

(Note that TypeScript allows us to overload the `Positive` identifier for both the type and our factory function.)

Now we can write things like:

```typescript
let p = Positive(1)
p = -1           // <- compiler error!
p = Positive(-1) // <- runtime error!
let q = Positive(2)
p = q            // <- ok!
```

So what if we want an io-ts Positive type?

```typescript
const PositiveV = new t.Type<Positive, any>(
    'Positive',
    (m): m is Positive => typeof m === 'number' && m >= 0,
    (m, c) => t.number.validate(m, c).chain(
        n => n < 0 ? t.failure(s, c) : t.success(d)
    ),
    t.identity
)
```

Now if we decode, the `Right` result is nominally typed as `Positive`:

```typescript
PositiveV.decode(1).map(p => {
    p = -1 // <- compiler error!
})
```

One thing I didn't like about this is we have two identifiers: `Positive` and `PositiveV`. It seemed it would be nice to merge all of this into one. Turns out we can do that by extendng the `t.Type` class and adding a static factory method. Let's call that method "`of`":

```typescript
type Positive = number & {__Positive: never}

export class PositiveType extends t.Type<Positive> {
    readonly _tag: 'PositiveType' = 'PositiveType'

    constructor() {
        super('Positive',
            (m): m is Positive => typeof m === 'number' && m >= 0,
            (m, c) => !this.is(m) ? t.failure<Positive>(m, c) : t.success(m),
            t.identity
        )
    }

    /** Creates a `Positive` value from the given input value. */
    of (m: any) {
        return this.decode(m).getOrElseL(e => {
            throw new Error('Invalid ' + this.name)
        })
    }
}

const Positive = new PositiveType()

export default Positive
```

Now we can use it like:

```typescript
import Positive from './positive'

const p = Positive.of(1)
Positive.decode(x).fold(...)
function f(p: Positive) {...}

const Song = t.interface({
    title: t.string,
    duration: Positive
})
```

We could add other handy static methods to `PositiveType` if we need them:

```typescript
let a = Positive.add(b, c)
```

If you want to make the `of` method available for all Type objects, we can patch `Type.prototype` and augment the io-ts type definition:

```typescript
declare module 'io-ts' {
	interface Type<A, O, I> {
		of (i: I): A
	}
}

t.Type.prototype.of = function(i) {
	return this.decode(i).getOrElseL(e => {
		throw new IOTypeError('Invalid ' + this.name, e)
	})
}
```

Now creating a Positive type with a factory function is simplified to:

```typescript
type Positive = number & {__Positive: never}

export class PositiveType extends TypeFactory<Positive> {
    readonly _tag: 'PositiveType' = 'PositiveType'

    constructor() {
        super('Positive',
            (m): m is Positive => typeof m === 'number' && m >= 0,
            (m, c) => !this.is(m) ? t.failure<Positive>(m, c) : t.success(m),
            t.identity
        )
    }
}

const Positive = new PositiveType()

export default Positive
```

[@gcanti](https://github.com/gcanti) suggested a more succinct branding helper that works with `t.refinement`:

```typescript
export function brand<RT extends t.Any, A, O, I>(
    type: t.RefinementType<RT, A, O, I>
): <B>() => t.RefinementType<RT, A & B, O, I>
export function brand<A, O, I>(type: t.Type<A, O, I>): <B>() => t.Type<A & B, O, I> {
    return () => type as any
}
```

Which could be used like so:

```typescript
const Positive = brand(
    t.refinement(t.number, n => n >= 0, 'Positive')
)<{__Positive: never}>()

type Positive = t.TypeOf<typeof Positive>

const p: Positive = Positive.decode(1).getOrElseL(err => {...})
```

## Objects

One thing I was a bit surprised by is that io-ts's `decode` method returns the *same* object rather than a copy. Additionally, it will not strip out extraneous properties that are not part of the interface type.

`io-ts` includes a `strict` helper that will create an `Interface` type that only accepts recognized properties. Sometimes however you might want to allow inputs that contain additional properties, but be sure that those properties are stripped from the validated result, and that a new object is returned rather than a reference to the input.

For this, [@gcanti](https://github.com/gcanti) suggested a `strip` helper. I wanted to use this not only for `Interface` types but also with `Partial` and `Intersection` types that are a mix of required and optional properties. These require the following three variations:

```typescript
/** Returns an Interface type that returns a new object from validate and omits extraneous properties. */
export function stripInterface<P extends t.Props, A, O>(type: t.InterfaceType<P, A, O>): t.InterfaceType<P, A, O> {
	const keys = Object.keys(type.props)
	const len = keys.length
	return new t.InterfaceType(
		type.name,
		type.is,
		(m, c) => type.validate(m, c).map((o: any) => {
			const r: any = {}
			for (let i = 0; i < len; i++) {
				const k = keys[i]
				r[k] = o[k]
			}
			return r
		}),
		type.encode,
		type.props
	)
}

/** Returns a Partial type that returns a new object from validate and omits extraneous properties. */
export function stripPartial<P extends t.Props, A, O>(type: t.PartialType<P, A, O>): t.PartialType<P, A, O> {
	const keys = Object.keys(type.props)
	const len = keys.length
	return new t.PartialType(
		type.name,
		type.is,
		(m, c) => type.validate(m, c).map((o: any) => {
			const r: any = {}
			for (let i = 0; i < len; i++) {
				const k = keys[i]
				// Optional properties can be skipped if omitted
				if (Object.prototype.hasOwnProperty.call(o, k)) {
					r[k] = o[k]
				}
			}
			return r
		}),
		type.encode,
		type.props
	)
}

/** Internal helper function that finds all property keys in an intersection type */
function getIntersectionKeys<RTS extends t.Type<any, any, any>[], A, O, I>(type: t.IntersectionType<RTS, A, O, I>) {
	const propKeys: Record<string, number> = {}
	type.types.forEach((tp: any) => {
		if (!tp.props) {
			console.warn('getIntersectionKeys encountered a type without props')
		}
		const tpkeys = Object.keys(tp.props)
		for (let i = 0; i < tpkeys.length; ++i) {
			propKeys[tpkeys[i]] = 1
		}
	})
	return Object.keys(propKeys)
}

/** Returns an Intersection type that returns a new object from validate and omits extraneous properties. */
export function stripIntersection<RTS extends t.Type<any, any, any>[], A, O, I>(type: t.IntersectionType<RTS, A, O, I>): t.IntersectionType<RTS, A, O, I> {
	const keys = getIntersectionKeys(type)
	const len = keys.length
	return new t.IntersectionType(
		type.name,
		type.is,
		(m, c) => type.validate(m, c).map((o: any) => {
			const r: any = {}
			for (let i = 0; i < len; i++) {
				const k = keys[i]
				// Intersection may have optional properties that we can skip if omitted
				if (Object.prototype.hasOwnProperty.call(o, k)) {
					r[k] = o[k]
				}
			}
			return r
		}),
		type.encode,
		type.types
	)
}
```

Finally I wanted a shorter, overloaded wrapper function:

```typescript
/** Returns an Interface type that returns a new object from validate and omits extraneous properties. */
export function strip<P extends t.Props, A, O>(type: t.InterfaceType<P, A, O>): t.InterfaceType<P, A, O>
/** Returns a Partial type that returns a new object from validate and omits extraneous properties. */
export function strip<P extends t.Props, A, O>(type: t.PartialType<P, A, O>): t.PartialType<P, A, O>
/** Returns an Intersection type that returns a new object from validate and omits extraneous properties. */
export function strip<RTS extends t.Type<any, any, any>[], A, O, I>(type: t.IntersectionType<RTS, A, O, I>): t.IntersectionType<RTS, A, O, I>
export function strip<T>(type: T): T {
	if (type instanceof t.IntersectionType) {
		return stripIntersection(type) as any as T
	}
	if (type instanceof t.PartialType) {
		return stripPartial(type) as any as T
	}
	if (type instanceof t.InterfaceType) {
		return stripInterface(type) as any as T
	}
	throw new Error("strip expects an Interface, Partial or Intersection type")
}
```

Example use:

```typescript
const Song = strip(t.interface({
    title: t.string,
    duration: Positive
}, 'Song'))

Song.decode({
    title: 'Blue Holiday',
    duration: 225,
    extra: 'xyz'
}).map(song => {
    console.log(song)
    // Outputs: {title: 'Blue Holiday', duration: 225}
})
```

## See also:

[io-ts form validation example](https://github.com/spacejack/io-ts-form-example)
