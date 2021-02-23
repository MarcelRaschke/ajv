import type Ajv from "../../core"
import type {SchemaObject} from "../../types"
import {jtdForms, JTDForm, SchemaObjectMap} from "./types"
import {SchemaEnv, getCompilingSchema} from ".."
import {_, str, and, nil, not, CodeGen, Code, Name, SafeExpr} from "../codegen"
import {MissingRefError} from "../error_classes"
import N from "../names"
import {isOwnProperty, hasPropFunc} from "../../vocabularies/code"
import {hasRef} from "../../vocabularies/jtd/ref"
import {intRange, IntType} from "../../vocabularies/jtd/type"
import {parseJson, parseJsonNumber, parseJsonString, skipWhitespace} from "../../runtime/parseJson"
import {func} from "../util"
import validTimestamp from "../timestamp"

type GenParse = (cxt: ParseCxt) => void

const genParse: {[F in JTDForm]: GenParse} = {
  elements: parseElements,
  values: parseValues,
  discriminator: parseDiscriminator,
  properties: parseProperties,
  optionalProperties: parseProperties,
  enum: parseEnum,
  type: parseType,
  ref: parseRef,
}

interface ParseCxt {
  readonly gen: CodeGen
  readonly self: Ajv // current Ajv instance
  readonly schemaEnv: SchemaEnv
  readonly definitions: SchemaObjectMap
  schema: SchemaObject
  data: Code
  parseName: Name
}

export default function compileParser(
  this: Ajv,
  sch: SchemaEnv,
  definitions: SchemaObjectMap
): SchemaEnv {
  const _sch = getCompilingSchema.call(this, sch)
  if (_sch) return _sch
  const {es5, lines} = this.opts.code
  const {ownProperties} = this.opts
  const gen = new CodeGen(this.scope, {es5, lines, ownProperties})
  const parseName = gen.scopeName("parse")
  const cxt: ParseCxt = {
    self: this,
    gen,
    schema: sch.schema as SchemaObject,
    schemaEnv: sch,
    definitions,
    data: N.data,
    parseName,
  }

  let sourceCode: string | undefined
  try {
    this._compilations.add(sch)
    sch.parseName = parseName
    parserFunction(cxt)
    gen.optimize(this.opts.code.optimize)
    const parseFuncCode = gen.toString()
    sourceCode = `${gen.scopeRefs(N.scope)}return ${parseFuncCode}`
    const makeParse = new Function(`${N.scope}`, sourceCode)
    const parse: (json: string) => unknown = makeParse(this.scope.get())
    this.scope.value(parseName, {ref: parse})
    sch.parse = parse
  } catch (e) {
    if (sourceCode) this.logger.error("Error compiling parser, function code:", sourceCode)
    delete sch.parse
    delete sch.parseName
    throw e
  } finally {
    this._compilations.delete(sch)
  }
  return sch
}

const undef = _`undefined`

function parserFunction(cxt: ParseCxt): void {
  const {gen, parseName} = cxt
  gen.func(parseName, _`${N.json}, ${N.jsonPos}, ${N.jsonPart}`, false, () => {
    gen.let(N.data)
    gen.assign(_`${parseName}.error`, undef)
    gen.assign(N.jsonPos, _`${N.jsonPos} || 0`)
    gen.const(N.jsonLen, _`${N.json}.length`)
    parseCode(cxt)
    whitespace(gen)
    gen.if(N.jsonPart, () => gen.return(_`[${N.data}, ${N.jsonPos}]`))
    gen.if(_`${N.jsonPos} === ${N.jsonLen}`, () => gen.return(N.data))
    jsonSyntaxError(cxt)
  })
}

function parseCode(cxt: ParseCxt): void {
  let form: JTDForm | undefined
  for (const key of jtdForms) {
    if (key in cxt.schema) {
      form = key
      break
    }
  }
  parseNullable(cxt, form ? genParse[form] : parseEmpty)
}

function parseNullable(cxt: ParseCxt, parseForm: GenParse): void {
  const {gen, schema, data} = cxt
  if (!schema.nullable) return parseForm(cxt)
  tryParseToken(cxt, "null", parseForm, () => gen.assign(data, null))
}

function parseElements(cxt: ParseCxt): void {
  const {gen, schema, data} = cxt
  parseToken(cxt, "[")
  const ix = gen.let("i", 0)
  gen.assign(data, _`[]`)
  parseItems(cxt, "]", () => {
    const el = gen.let("el")
    parseCode({...cxt, schema: schema.elements, data: el})
    gen.assign(_`${data}[${ix}++]`, el)
  })
}

function parseValues(cxt: ParseCxt): void {
  const {gen, schema, data} = cxt
  parseToken(cxt, "{")
  gen.assign(data, _`{}`)
  parseItems(cxt, "}", () => parseKeyValue(cxt, schema.values))
}

function parseItems(cxt: ParseCxt, endToken: string, block: () => void): void {
  tryParseItems(cxt, endToken, block)
  parseToken(cxt, endToken)
}

function tryParseItems(cxt: ParseCxt, endToken: string, block: () => void): void {
  const {gen} = cxt
  gen.for(_`;${N.jsonPos}<${N.jsonLen} && ${jsonSlice(1)}!==${endToken};`, () => {
    block()
    tryParseToken(cxt, ",", () => gen.break())
  })
}

function parseKeyValue(cxt: ParseCxt, schema: SchemaObject): void {
  const {gen} = cxt
  const key = gen.let("key")
  parseString({...cxt, data: key})
  checkDuplicateProperty(cxt, key)
  parseToken(cxt, ":")
  parsePropertyValue(cxt, key, schema)
}

function parseDiscriminator(cxt: ParseCxt): void {
  const {gen, data, schema} = cxt
  const {discriminator, mapping} = schema
  parseToken(cxt, "{")
  gen.assign(data, _`{}`)
  const startPos = gen.const("pos", N.jsonPos)
  const value = gen.let("value")
  const tag = gen.let("tag")
  tryParseItems(cxt, "}", () => {
    const key = gen.let("key")
    parseString({...cxt, data: key})
    parseToken(cxt, ":")
    gen.if(
      _`${key} === ${discriminator}`,
      () => {
        parseString({...cxt, data: tag})
        gen.assign(_`${data}[${key}]`, tag)
        gen.break()
      },
      () => parseEmpty({...cxt, data: value}) // can be discarded/skipped
    )
  })
  gen.assign(N.jsonPos, startPos)
  gen.if(_`${tag} === undefined`)
  parsingErrorMsg(cxt, "discriminator tag not found")
  for (const tagValue in mapping) {
    gen.elseIf(_`${tag} === ${tagValue}`)
    parseSchemaProperties({...cxt, schema: mapping[tagValue]}, discriminator)
  }
  gen.else()
  parsingErrorMsg(cxt, "discriminator value not in schema")
  gen.endIf()
}

function parseProperties(cxt: ParseCxt): void {
  const {gen, data} = cxt
  parseToken(cxt, "{")
  gen.assign(data, _`{}`)
  parseSchemaProperties(cxt)
}

function parseSchemaProperties(cxt: ParseCxt, discriminator?: string): void {
  const {gen, schema, data} = cxt
  const {properties, optionalProperties, additionalProperties} = schema
  parseItems(cxt, "}", () => {
    const key = gen.let("key")
    parseString({...cxt, data: key})
    if (discriminator) {
      gen.if(_`${key} !== ${discriminator}`, () => checkDuplicateProperty(cxt, key))
    } else {
      checkDuplicateProperty(cxt, key)
    }
    parseToken(cxt, ":")
    gen.if(false)
    parseDefinedProperty(cxt, key, properties)
    parseDefinedProperty(cxt, key, optionalProperties)
    if (discriminator) {
      gen.elseIf(_`${key} === ${discriminator}`)
      const tag = gen.let("tag")
      parseString({...cxt, data: tag}) // can be discarded, it is already assigned
    }
    gen.else()
    if (additionalProperties) {
      parseEmpty({...cxt, data: _`${data}[${key}]`})
    } else {
      parsingErrorMsg(cxt, str`property ${key} not allowed`)
    }
    gen.endIf()
  })
  if (properties) {
    const hasProp = hasPropFunc(gen)
    const allProps: Code = and(
      ...Object.keys(properties).map((p): Code => _`${hasProp}.call(${data}, ${p})`)
    )
    gen.if(not(allProps), () => parsingErrorMsg(cxt, "missing required properties"))
  }
}

function parseDefinedProperty(cxt: ParseCxt, key: Name, schemas: SchemaObjectMap = {}): void {
  const {gen} = cxt
  for (const prop in schemas) {
    gen.elseIf(_`${key} === ${prop}`)
    parsePropertyValue(cxt, key, schemas[prop] as SchemaObject)
  }
}

function checkDuplicateProperty({gen, data}: ParseCxt, key: Name): void {
  gen.if(isOwnProperty(gen, data, key), () =>
    gen.throw(_`new Error("JSON: duplicate property " + ${key})`)
  )
}

function parsePropertyValue(cxt: ParseCxt, key: Name, schema: SchemaObject): void {
  parseCode({...cxt, schema, data: _`${cxt.data}[${key}]`})
}

function parseType(cxt: ParseCxt): void {
  const {gen, schema, data} = cxt
  switch (schema.type) {
    case "boolean":
      parseBoolean(true, parseBoolean(false, jsonSyntaxError))(cxt)
      break
    case "string":
      parseString(cxt)
      break
    case "timestamp": {
      // TODO parse timestamp?
      parseString(cxt)
      const vts = func(gen, validTimestamp)
      gen.if(_`!${vts}(${data})`, () => parsingErrorMsg(cxt, "invalid timestamp"))
      break
    }
    case "float32":
    case "float64":
      parseNumber(cxt)
      break
    default: {
      const [min, max, maxDigits] = intRange[schema.type as IntType]
      parseNumber(cxt, maxDigits)
      gen.if(_`${data} < ${min} || ${data} > ${max}`, () =>
        parsingErrorMsg(cxt, "integer out of range")
      )
    }
  }
}

function parseString(cxt: ParseCxt): void {
  parseToken(cxt, '"')
  parseWith(cxt, parseJsonString)
}

function parseEnum(cxt: ParseCxt): void {
  const {gen, data, schema} = cxt
  const enumSch = schema.enum
  parseToken(cxt, '"')
  // TODO loopEnum
  gen.if(false)
  for (const value of enumSch) {
    const valueStr = JSON.stringify(value).slice(1) // remove starting quote
    gen.elseIf(_`${jsonSlice(valueStr.length)} === ${valueStr}`)
    gen.assign(data, str`${value}`)
    gen.add(N.jsonPos, valueStr.length)
  }
  gen.else()
  jsonSyntaxError(cxt)
  gen.endIf()
}

function parseNumber(cxt: ParseCxt, maxDigits?: number): void {
  const {gen} = cxt
  gen.assign(N.jsonPos, _`${func(gen, skipWhitespace)}(${N.json}, ${N.jsonPos})`)
  gen.if(
    _`"-0123456789".indexOf(${jsonSlice(1)}) < 0`,
    () => jsonSyntaxError(cxt),
    () => parseWith(cxt, parseJsonNumber, maxDigits)
  )
}

function parseBoolean(bool: boolean, fail: GenParse): GenParse {
  return (cxt) => {
    const {gen, data} = cxt
    tryParseToken(
      cxt,
      `${bool}`,
      () => fail(cxt),
      () => gen.assign(data, bool)
    )
  }
}

function parseRef(cxt: ParseCxt): void {
  const {gen, self, definitions, schema, schemaEnv} = cxt
  const {ref} = schema
  const refSchema = definitions[ref]
  if (!refSchema) throw new MissingRefError("", ref, `No definition ${ref}`)
  if (!hasRef(refSchema)) return parseCode({...cxt, schema: refSchema})
  const {root} = schemaEnv
  const sch = compileParser.call(self, new SchemaEnv({schema: refSchema, root}), definitions)
  partialParse(cxt, getParser(gen, sch), true)
}

function getParser(gen: CodeGen, sch: SchemaEnv): Code {
  return sch.parse
    ? gen.scopeValue("parse", {ref: sch.parse})
    : _`${gen.scopeValue("wrapper", {ref: sch})}.parse`
}

function parseEmpty(cxt: ParseCxt): void {
  parseWith(cxt, parseJson)
}

function parseWith(cxt: ParseCxt, parseFunc: {code: Code}, args?: SafeExpr): void {
  const f = cxt.gen.scopeValue("func", {
    ref: parseFunc,
    code: parseFunc.code,
  })
  partialParse(cxt, f, args)
}

function partialParse(cxt: ParseCxt, parseFunc: Name, args?: SafeExpr): void {
  const {gen, data} = cxt
  gen.assign(
    _`[${data}, ${N.jsonPos}]`,
    _`${parseFunc}(${N.json}, ${N.jsonPos}${args ? _`, ${args}` : nil})`
  )
  gen.if(_`${data} === undefined`, () => parsingError(cxt, _`${parseFunc}.error`))
}

function parseToken(cxt: ParseCxt, tok: string): void {
  tryParseToken(cxt, tok, jsonSyntaxError)
}

function tryParseToken(cxt: ParseCxt, tok: string, fail: GenParse, success?: GenParse): void {
  const {gen} = cxt
  const n = tok.length
  whitespace(gen)
  gen.if(
    _`${jsonSlice(n)} === ${tok}`,
    () => {
      gen.add(N.jsonPos, n)
      success?.(cxt)
    },
    () => fail(cxt)
  )
}

function whitespace(gen: CodeGen): void {
  gen.assign(N.jsonPos, _`${func(gen, skipWhitespace)}(${N.json}, ${N.jsonPos})`)
}

function jsonSlice(len: number | Name): Code {
  return len === 1
    ? _`${N.json}[${N.jsonPos}]`
    : _`${N.json}.slice(${N.jsonPos}, ${N.jsonPos}+${len})`
}

function jsonSyntaxError(cxt: ParseCxt): void {
  parsingErrorMsg(cxt, _`"unexpected token " + ${N.json}[${N.jsonPos}]`)
}

function parsingErrorMsg(cxt: ParseCxt, msg: Code | string): void {
  parsingError(cxt, cxt.gen.object(["message", msg], ["position", N.jsonPos]))
}

function parsingError({gen, parseName}: ParseCxt, err: Code): void {
  gen.assign(_`${parseName}.error`, err)
  gen.return(_`${N.jsonPart} ? [undefined, ${N.jsonPos}] : undefined`)
}
