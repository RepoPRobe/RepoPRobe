import { Schema, model, Types } from "mongoose";
import { Hunk, HunkType } from "./PullRequestFile.js";

export interface ConflictType {
	_id: Types.ObjectId;
	file: string;
	prAId: Types.ObjectId;
	prBId: Types.ObjectId;
	prAHunk: HunkType;
	prBHunk: HunkType;
	conflictingLineNumbers: {
		removed: number[];
		added: number[];
	};
	createdAt: Date;
	updatedAt: Date;
}

const conflictSchema = new Schema<ConflictType>({
	file: {
		type: String,
		required: true,
	},
	prAId: {
		type: Schema.Types.ObjectId,
		required: true,
	},
	prBId: {
		type: Schema.Types.ObjectId,
		required: true,
	},
	prAHunk: {
		type: Hunk,
		required: true,
	},
	prBHunk: {
		type: Hunk,
		required: true,
	},
	conflictingLineNumbers: {
		removed: {
			type: [Number],
			required: true,
		},
		added: {
			type: [Number],
			required: true,
		},
	},
}, { timestamps: true });

export const Conflict = model<ConflictType>("Conflict", conflictSchema);