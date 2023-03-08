
import React from "react";
import { Link } from "react-router-dom";
const Footer = () => {
  return (
    <div className="footer bg-light pt-5">
      <p className="text-center mt-3">
        <Link to="/about">About</Link>|<Link to="/contact">Contact</Link>|
        <Link to="/policy">Privacy Policy</Link>
      </p>
      <h6 className="text-center">All Right Reserved &copy; GADGET APP</h6>
    </div>
  );
};

export default Footer;