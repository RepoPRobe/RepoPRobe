import { model, Schema, Types } from "mongoose";
import { AllowedAuthorAssociations } from "../../utils/common";

export interface InactivityThresholdType {
    value: number;
    unit: 'minutes' | 'hours' | 'days';
}

export interface RepoConfigType {
    _id: Types.ObjectId;
    repoId: Types.ObjectId;
    autoTrack: boolean;
    ignoreDraftPRs: boolean;
    excludeLabels: string[];
    excludeFilePatterns: string[];
    sameBaseBranchOnly: boolean;
    inactivityThreshold: InactivityThresholdType;
    allowed_author_assoication: string[];
    createdAt: Date;
    updatedAt: Date;
}

const repoConfigSchema = new Schema<RepoConfigType>({
    repoId: { type: Schema.Types.ObjectId, ref: 'Repo', required: true },
    autoTrack: { type: Boolean, default: true },
    ignoreDraftPRs: { type: Boolean, default: true },
    excludeLabels: { type: [String], default: [] },
    excludeFilePatterns: { type: [String], default: [] },
    sameBaseBranchOnly: { type: Boolean, default: true },
    inactivityThreshold: {
        value: { type: Number, default: 14 },
        unit: { type: String, enum: ['minutes', 'hours', 'days'], default: 'days' }
    },
    allowed_author_assoication: {
        type: [String],
        enum: AllowedAuthorAssociations,
        default: () => [...AllowedAuthorAssociations],
    }
}, { timestamps: true });

export const RepoConfig = model<RepoConfigType>('RepoConfig', repoConfigSchema);