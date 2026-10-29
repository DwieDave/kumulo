import { RuleTester } from "../../../rule-tester.ts";

import { noManualTagComparisonRule } from "../../../../src/anti-slop/effect/rules/no-manual-tag-comparison.ts";

new RuleTester().run("no-manual-tag-comparison", noManualTagComparisonRule, {
	valid: [
		"Predicate.isTagged(\"Ready\")(value);",
		"Match.value(value).pipe(Match.tag(\"Ready\", handleReady));",
		'if (value.status === "Ready") handleReady(value);',
		'Effect.catch((error) => error._tag === "NotFound" ? recover : fail);',
	],
	invalid: [
		{
			code: 'value._tag === "Ready";',
			errors: [{ messageId: "manualComparison" }],
		},
		{
			code: '"Ready" !== value["_tag"];',
			errors: [{ messageId: "manualComparison" }],
		},
		{
			code: "switch (value._tag) { case \"Ready\": handleReady(value); }",
			errors: [{ messageId: "manualSwitch" }],
		},
	],
});
