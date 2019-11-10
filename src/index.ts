import * as t from 'io-ts'

// NOTE: This source is deprecated and no longer needed, as of io-ts version 2.

// NOTE: This module must be imported before Type.prototype.of is used.

// Augment the io-ts module
declare module 'io-ts' {
	interface Type<A, O, I> {
		/** Returns decoded value, throws IOTypeError on invalid input */
		of (i: I): A
	}
}

// Patches the t.Type prototype to add an `of` method
t.Type.prototype.of = function(i) {
	return this.decode(i).getOrElseL(e => {
		throw new IOTypeError('Invalid ' + this.name, e)
	})
}

/** Error object that contains io-ts validation errors */
export class IOTypeError {
	constructor (public message: string, public validationErrors: t.ValidationError[]) {}
}

export function brand<RT extends t.Any, A, O, I>(type: t.RefinementType<RT, A, O, I>): <B>() => t.RefinementType<RT, A & B, O, I>
export function brand<A, O, I>(type: t.Type<A, O, I>): <B>() => t.Type<A & B, O, I> {
    return () => type as any
}

/** Returns a type that contains required and optional properties */
export function interfaceWithOptionals<RequiredProps extends t.Props, OptionalProps extends t.Props>(
	required: RequiredProps,
	optional: OptionalProps,
	name?: string
): t.IntersectionType<
	[
		t.InterfaceType<RequiredProps, t.TypeOfProps<RequiredProps>>,
		t.PartialType<OptionalProps, t.TypeOfPartialProps<OptionalProps>>
	],
	t.TypeOfProps<RequiredProps> & t.TypeOfPartialProps<OptionalProps>
 > {
	return t.intersection([t.interface(required), t.partial(optional)], name)
}

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
