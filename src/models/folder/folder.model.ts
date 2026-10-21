import { Schema, type Types } from "mongoose";
import { auditedModel } from "../../core/audit/auditedModel";

export interface FolderInterface {
  code: string;
  name: string;
  parentId: Types.ObjectId | null;
  createdAt?: Date;
  updatedAt?: Date;
}

const folderSchema = new Schema<FolderInterface>(
  {
    code: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    parentId: {
      type: Schema.Types.ObjectId,
      ref: "Folder",
      default: null,
    },
  },
  { timestamps: true },
);

folderSchema.index(
  { parentId: 1, code: 1 },
  { unique: true, collation: { locale: "en", strength: 2 } },
);

export const FolderRepo = auditedModel<FolderInterface>("Folder", folderSchema);
