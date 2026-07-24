/** OVH proprietary v1 schema shapes (subset actually consumed by the converter). */

export interface OvhParameter {
  readonly name?: string
  readonly dataType: string
  readonly paramType: "path" | "query" | "body"
  readonly fullType: string
  readonly required: boolean
  readonly description?: string
}

export interface OvhOperation {
  readonly httpMethod: string
  readonly operationId?: string
  readonly description?: string
  readonly parameters: readonly OvhParameter[]
  readonly responseType: string
}

export interface OvhApi {
  readonly path: string
  readonly description?: string
  readonly operations: readonly OvhOperation[]
}

export interface OvhPropertySchema {
  readonly fullType: string
  readonly description?: string
  readonly required?: boolean
  readonly canBeNull?: boolean
}

export interface OvhObjectModel {
  readonly id: string
  readonly namespace: string
  readonly description?: string
  readonly properties: Record<string, OvhPropertySchema>
}

export interface OvhEnumModel {
  readonly id: string
  readonly namespace: string
  readonly description?: string
  readonly enum: readonly string[]
  readonly enumType: string
}

export type OvhModel = OvhObjectModel | OvhEnumModel

export interface OvhSchema {
  readonly apiVersion?: string
  readonly apis: readonly OvhApi[]
  readonly models: Record<string, OvhModel>
}

export function isEnumModel(model: OvhModel): model is OvhEnumModel {
  return "enum" in model
}
