# Nominal types and factories for io-ts

I have been exploring [io-ts](https://github.com/gcanti/io-ts) for a little while now, as a solution for validation and other run-time type checks. I've made a few observations along the way and some patterns are emerging from my use of it so far.

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

The `Right` of the resulting `Either` will contain a valid positive number. However, what if we do this:

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

If you're creating a lot of primitive types, you can eliminate some repetition by subclassing `t.Type`:

```typescript
export class TypeFactory<T> extends t.Type<T> {
    of (m: any): T {
        return this.decode(m).getOrElseL(e => {
            throw new Error('Invalid ' + this.name)
        })
    }
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

After sharing the above with [@gcanti](https://github.com/gcanti), he suggested a more succinct branding helper, in case you just want the run-time type without the factory function:

```typescript
export function brand<RT extends t.Any, A, O, I>(
    type: t.RefinementType<RT, A, O, I>
): <B>() => t.RefinementType<RT, A & B, O, I>
export function brand<A, O, I>(type: t.Type<A, O, I>): <B>() => t.Type<A & B, O, I>
export function brand<A, O, I>(type: t.Type<A, O, I>): <B>() => t.Type<A & B, O, I> {
    return () => type as any
}
```

Which could be used like so:

```typescript
const Positive = brand(t.refinement(
    t.number, n => n >= 0, 'Positive'
))<Record<'__Positive', never>>()

type Positive = t.TypeOf<typeof Positive>

const p: Positive = Positive.decode(1).getOrElseL(err => {...})
```

## Objects

Now that we have some helpers for primitive types, what can we do for objects? It's possible you might not need any helpers for objects. If objects always come from untrusted sources and you're comfortable working with `Either` types, then you'll probably always want to `decode` those.

But what if you have a trusted source and a validation error is truly an exceptional occurrance? Always needing to handle an `Either` can sometimes be inconvenient, so maybe a factory function would be helpful. Or maybe you're adding io-ts to a project that has been using exceptions for error handling. Using Either types isn't necessarily difficult but a helper that automatically throws may reduce a bit of friction involved if you just want the run-time types.

One thing I was a bit surprised by is that io-ts's `decode` method returns the *same* object rather than a copy. Additionally, it will not strip out extraneous properties that are not part of the interface type.

In these cases I've found the following helper function to be useful:

```typescript
/** Helper that adds a factory method to the supplied interface type */
export function interfaceFactory<
    I extends (t.InterfaceType<any> | t.IntersectionType<any> | t.PartialType<any>),
    T = t.TypeOf<I>
>(iface: I) {
    return Object.assign(iface, {
        /** Creates a new instance from the input. Throws on invalid input. */
        of (r: Record<string, any>): T {
            return iface.decode(r).fold(
                e => {
                    throw new IOTypeError(iface.name + ' type error', e)
                },
                o => {
                    // create returns a new instance, not the same object that was supplied.
                    // Therefore we can strip out extraneous properties.
                    const a: Record<string, any> = {}
                    const props = getProps<keyof T>(iface)
                    props.forEach(p => {
                        a[p] = o[p]
                    })
                    return a as T
                }
            )
        }
    })
}

/** A custom Error type that includes the validation error information */
export class IOTypeError extends Error {
    validationErrors: t.ValidationError[]
    constructor(message: string, errs: t.ValidationError[]) {
        super(message)
        this.validationErrors = errs
    }
}

/**
 * Used internally by interfaceFactory.
 * Gets all props from an interface, partial or union type.
 */
function getProps<T extends string> (i: any) {
    if (i.props) {
        return Object.keys(i.props) as T[]
    } else if (i.types && i.types) {
        let props: T[] = []
        i.types.forEach((tp: any) => {
            if (!tp.props) {
                throw new Error('interfaceFactory expects that all types in a union have props')
            }
            props = props.concat(Object.keys(tp.props) as T[])
        })
        return props
    } else {
        throw new Error('interfaceFactory expects a type with props')
    }
}
```

Unlike primitive types, we cannot easily extend an interface Type, so this function directly adds an `of` method to the io-ts type object. It can be used like so:

```typescript
const Song = interfaceFactory(t.interface({
    title: t.string,
    duration: Positive
}, 'Song'))

interface Song extends t.TypeOf<Song> {}
```

And now we can use our `Song` type/factory like this:

```typescript
const song: Song = Song.of({
    title: 'Mona Lisa and Mad Hatters',
    duration: 280
})
```

Of course we can still use io-ts validation:

```typescript
Song.decode({
    title: 'Blue Holiday',
    duration: 225
}).fold(
    //...
)
```

One more refinement: the type returned by `of` isn't very nice - editor tooling will display the object literal types rather than using the `Song` alias. We can get around that by explicitly providing types for our factory builder:

```typescript
const _Song = t.interface({
    title: t.string,
    duration: Positive
}, 'Song')

interface Song extends t.TypeOf<typeof _Song> {}

const Song = interfaceFactory<typeof _Song, Song>(_Song)

```

Now you get the type `Song` inferred here:

```typescript
const song = Song.of({...})
```
