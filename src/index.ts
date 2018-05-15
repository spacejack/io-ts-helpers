// io-ts Helpers

import * as t from 'io-ts'

/** A useful helper as suggested from io-ts docs */
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

/**
 * A class that can be extended to create primitive types that
 * have a factory method `of`.
 */
export class TypeFactory<T> extends t.Type<T> {
	of (m: any): T {
		return this.decode(m).getOrElseL(e => {
			throw new IOTypeError(this.name + ' type error', e)
		})
	}
}

/** Error object that contains io-ts validation errors */
export class IOTypeError extends Error {
	validationErrors: t.ValidationError[]
	constructor(message: string, errs: t.ValidationError[]) {
		super(message)
		this.validationErrors = errs
	}
}

/**
 * Gets all props from an interface, partial or union type.
 * Used internally by interfaceConstructor.
 */
function getProps<T extends string> (i: any) {
	if (i.props) {
		return Object.keys(i.props) as T[]
	} else if (i.types && i.types) {
		let props: T[] = []
		i.types.forEach((tp: any) => {
			if (!tp.props) {
				throw new Error('interfaceConstructor expects that all types in a union have props')
			}
			props = props.concat(Object.keys(tp.props) as T[])
		})
		return props
	} else {
		throw new Error('interfaceConstructor expects a type with props')
	}
}

/** Helper that adds a create method to the supplied interface type */
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
