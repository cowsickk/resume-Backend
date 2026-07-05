import bcrypt from "bcryptjs";

const password = "123456";

bcrypt.hash(password, 10).then(hash => {
  console.log(hash);
});