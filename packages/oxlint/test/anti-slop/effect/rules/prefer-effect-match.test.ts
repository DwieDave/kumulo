import { RuleTester } from "../../../rule-tester.ts";

import { preferEffectMatchRule } from "../../../../src/anti-slop/effect/rules/prefer-effect-match.ts";

new RuleTester().run("prefer-effect-match", preferEffectMatchRule, {
	valid: [
		'kind === "a" ? first : fallback;',
		'kind === "a" ? first : other === "b" ? second : fallback;',
		"condition ? first : otherCondition ? second : fallback;",
	],
	invalid: [
		{
			code: 'kind === "a" ? first : kind === "b" ? second : fallback;',
			errors: [{ messageId: "preferMatch" }],
		},
		{
			code: '`a` !== kind ? first : `b` === kind ? second : fallback;',
			errors: [{ messageId: "preferMatch" }],
		},
	],
});
