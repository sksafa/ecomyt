import { requireSignIn,isAdmin } from "../middlewares/authMiddleware.js";
import express from "express";
import {
  registerController,
  loginController,
  testController,
  forgotPasswordController
} from "../controllers/authController.js";


//router object
const router = express.Router();

//routing
//REGISTER || METHOD POST
router.post("/register", registerController);
router.post("/login", loginController);
router.get("/test", requireSignIn, isAdmin, testController);
//Forgot Password || POST
router.post("/forgot-password", forgotPasswordController);

router.get("/user-auth", requireSignIn,(req, res)=>{
  res.status(200).send({ok:true})
} );

//protected Admin route auth
router.get("/admin-auth", requireSignIn, isAdmin, (req, res) => {
  res.status(200).send({ ok: true });
});


export default router;