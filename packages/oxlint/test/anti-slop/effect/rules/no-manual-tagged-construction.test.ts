import { RuleTester } from "../../../rule-tester.ts";

import { noManualTaggedConstructionRule } from "../../../../src/anti-slop/effect/rules/no-manual-tagged-construction.ts";

new RuleTester().run(
	"no-manual-tagged-construction",
	noManualTaggedConstructionRule,
	{
		valid: [
			'Match.when({ _tag: "Ready" }, handleReady);',
			'Match.not({ "_tag": "Pending" });',
			"Ready.make({ value });",
			"new NotFound({ id });",
			"({ _tag: tag, value });",
		],
		invalid: [
			{
				code: 'const value = { _tag: "Ready", payload };',
				errors: [{ messageId: "manualConstruction" }],
			},
			{
				code: 'const value = { ["_tag"]: "Ready" };',
				errors: [{ messageId: "manualConstruction" }],
			},
		],
	},
);
