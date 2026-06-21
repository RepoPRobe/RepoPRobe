export const UserSchema = {
    id: { type: String, required: true },
    login: { type: String, required: true }, // username
    avatarUrl: { type: String, required: true },
    githubUrl: { type: String, required: true },
    userType: { type: String, required: true },
};
